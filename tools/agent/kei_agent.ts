#!/usr/bin/env bun
/**
 * kei_agent.ts — oh-my-pi(omp) 하네스 위에서 로컬 Qwen을 **도구 사용 에이전트**로 구동한다.
 *
 * 왜: 단발 RAG(검색 1회 → 생성 1회)는 첫 검색이 빗나가면 복구할 길이 없다. 에이전트는
 *     검색어를 바꿔 다시 찾고, 조문 전문·목차를 직접 열어 확인한 뒤 답한다.
 *
 * 경계(⛔): 도구는 RAG API의 **읽기 전용** 엔드포인트 3개뿐이다(검색·조문 열람·목차).
 *   omp 기본 도구(bash·read·edit·web 등)·MCP·LSP·스킬·확장 탐색은 전부 끈다 — 이 에이전트는
 *   파일시스템도 인터넷도 만지지 않는다. 모델은 사내 Ollama(127.0.0.1)뿐.
 *
 * 입력(stdin JSON): {question, history[], system, api, token, model{baseUrl,id,contextWindow,maxTokens},
 *                    maxToolCalls, agentDir, temperature, seed?{context,sources,hint}}
 *   seed = 서비스 단발 경로와 같은 1차 검색 결과. 에이전트는 이 [근거]에서 출발해 부족할 때만 도구로 보충한다
 *          → 근거가 단발 경로의 상위집합이 된다(실측: 시드 없이 시작하면 9B가 도구를 건너뛰고 지어냈다).
 * 출력(stdout 마지막 줄 JSON): {answer, evidence[{tool,args,context,sources}], toolCalls[], ms, error?}
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
	createAgentSession,
	discoverAuthStorage,
	ModelRegistry,
	SessionManager,
} from "@oh-my-pi/pi-coding-agent";

type Src = Record<string, unknown>;
type Evidence = { tool: string; args: Record<string, unknown>; context: string; sources: Src[] };

const input = JSON.parse(await Bun.stdin.text());
const t0 = Date.now();
const PROVIDER = "kei-local";
const evidence: Evidence[] = [];
const toolCalls: { tool: string; args: Record<string, unknown>; ms: number; chars: number }[] = [];
const seen = new Set<string>();
const maxCalls: number = input.maxToolCalls ?? 4;

// 격리된 omp 홈 — 사용자 ~/.omp 설정·자격증명·세션과 섞이지 않게(PI_CODING_AGENT_DIR와 같은 값).
const agentDir: string = input.agentDir;
mkdirSync(agentDir, { recursive: true });
writeFileSync(
	`${agentDir}/models.yml`,
	[
		"providers:",
		`  ${PROVIDER}:`,
		`    baseUrl: ${input.model.baseUrl}`,
		"    api: openai-completions",
		"    apiKey: ollama-local",
		"    models:",
		`      - id: "${input.model.id}"`,
		"        name: KEI Qwen (agent)",
		"        reasoning: false",
		"        input: [text]",
		`        contextWindow: ${input.model.contextWindow ?? 32768}`,
		`        maxTokens: ${input.model.maxTokens ?? 2048}`,
		"        compat:",
		"          supportsDeveloperRole: false",
		"          supportsStore: false",
		"          supportsReasoningEffort: false",
		"          maxTokensField: max_tokens",
		// Ollama /v1에서 사고 끄기는 reasoning_effort:none만 유효(rag_core._gen_extra 실측과 동일)
		"          extraBody:",
		"            reasoning_effort: none",
		"            think: false",
		"            keep_alive: -1",
		// omp는 temperature를 안 보낸다 → 모델 기본(고온)으로 돌아 외국어 파편·비결정 도구 호출이 났다(실측).
		// 서비스 단발 경로와 같은 0.1로 고정.
		`            temperature: ${input.temperature ?? 0.1}`,
		"",
	].join("\n"),
);

async function callApi(path: string, body: Record<string, unknown>) {
	const r = await fetch(`${input.api}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json", "X-KEI-Agent-Token": input.token },
		body: JSON.stringify(body),
	});
	if (!r.ok) throw new Error(`${path} HTTP ${r.status}`);
	return (await r.json()) as { text: string; sources?: Src[] };
}

const SEP = "\n\n---\n\n"; // rag_core 근거 블록 구분자
const head = (b: string) => (b.trim().split("\n", 1)[0] ?? "").trim();
const seenHeads = new Set<string>();

function textResult(text: string, details?: unknown) {
	return { content: [{ type: "text" as const, text }], details };
}

/** 도구 공통 래퍼 — 호출 한도·중복 호출 차단·근거 수집을 한 곳에서. */
function makeTool(
	name: string,
	label: string,
	description: string,
	parameters: Record<string, unknown>,
	path: string,
	mapArgs: (p: Record<string, string>) => Record<string, unknown>,
) {
	return {
		name,
		label,
		description,
		parameters,
		loadMode: "essential" as const,
		approval: "read" as const,
		async execute(_id: string, params: Record<string, string>) {
			const args = mapArgs(params);
			const key = `${name}:${JSON.stringify(args)}`;
			if (toolCalls.length >= maxCalls) {
				return textResult(
					`도구 호출 한도(${maxCalls}회)에 도달했습니다. 더 찾지 말고 지금까지 받은 [근거]만으로 최종 답변을 작성하세요.`,
				);
			}
			if (seen.has(key)) {
				return textResult("이미 같은 인자로 호출했습니다. 다른 검색어를 쓰거나, 지금까지의 [근거]로 답하세요.");
			}
			seen.add(key);
			const t = Date.now();
			try {
				const res = await callApi(path, args);
				// 이미 [근거]에 있는 블록은 다시 싣지 않는다 — 실측: 검색마다 시드와 같은 조문이 되돌아와
				// 문맥이 부풀고(Vulkan prefill이 병목) 2턴 시나리오 1문항이 450초 걸렸다.
				const fresh = res.text.split(SEP).filter(b => !seenHeads.has(head(b)));
				fresh.forEach(b => seenHeads.add(head(b)));
				const text = fresh.join(SEP).trim();
				const srcs = (res.sources ?? []).filter(s => fresh.some(b => head(b).includes(String(s.tag ?? "\u0000"))));
				toolCalls.push({ tool: name, args, ms: Date.now() - t, chars: text.length });
				if (!text) {
					return textResult("새 근거 없음 — 이미 [근거]에 있는 조문만 나왔습니다. 다른 문서 용어로 찾거나, 지금 [근거]로 답하세요.");
				}
				evidence.push({ tool: name, args, context: text, sources: srcs });
				return textResult(text);
			} catch (e) {
				toolCalls.push({ tool: name, args, ms: Date.now() - t, chars: 0 });
				return textResult(`도구 오류: ${(e as Error).message}`);
			}
		},
	};
}

const tools = [
	makeTool(
		"search_regs",
		"규정 검색",
		"KEI 사내 규정·업무가이드·시스템(ERP 등) 매뉴얼·용어집을 의미 검색해 관련 조문 원문 블록을 돌려준다. " +
			"검색어는 규정 원문에 나올 법한 문서 용어로 쓴다(예: '국내출장 일비 지급 기준', '연차휴가 사용 촉진').",
		{
			type: "object",
			properties: { query: { type: "string", description: "검색어(한국어, 규정 문서 용어 위주)" } },
			required: ["query"],
		},
		"/v1/agent/search",
		p => ({ query: String(p.query ?? "").trim() }),
	),
	makeTool(
		"read_article",
		"조문 열람",
		"규정명과 조(예: '제18조', '별표 2')를 지정해 그 조문의 **전문**을 읽는다. 검색 결과가 잘렸거나(일부), " +
			"본문이 다른 조·별표를 인용할 때 그 원문을 확인하는 데 쓴다.",
		{
			type: "object",
			properties: {
				regulation: { type: "string", description: "규정명(검색 결과 대괄호 안의 이름 그대로)" },
				article: { type: "string", description: "조 라벨 — 예: '제18조', '별표 2'" },
			},
			required: ["regulation", "article"],
		},
		"/v1/agent/article",
		p => ({ regulation: String(p.regulation ?? "").trim(), article: String(p.article ?? "").trim() }),
	),
	makeTool(
		"list_articles",
		"규정 목차",
		"규정명을 주면 그 규정의 조문 목차(조 번호와 제목)를 돌려준다. 어느 조를 열어야 할지 모를 때 쓴다.",
		{
			type: "object",
			properties: { regulation: { type: "string", description: "규정명" } },
			required: ["regulation"],
		},
		"/v1/agent/toc",
		p => ({ regulation: String(p.regulation ?? "").trim() }),
	),
];

function emit(obj: Record<string, unknown>) {
	process.stdout.write(`\n${JSON.stringify(obj)}\n`);
}

try {
	const authStorage = await discoverAuthStorage(agentDir);
	const modelRegistry = new ModelRegistry(authStorage);
	await modelRegistry.refresh("offline");
	const model = modelRegistry.find(PROVIDER, input.model.id);
	if (!model) throw new Error(`모델 미발견: ${PROVIDER}/${input.model.id}`);

	const { session } = await createAgentSession({
		cwd: agentDir,
		agentDir,
		authStorage,
		modelRegistry,
		model,
		thinkingLevel: "off",
		systemPrompt: [input.system],
		customTools: tools as never,
		toolNames: tools.map(t => t.name),
		restrictToolNames: true,
		allowRestrictedCustomTools: true,
		disableExtensionDiscovery: true,
		enableMCP: false,
		enableLsp: false,
		enableIrc: false,
		skipPythonPreflight: true,
		skills: [],
		rules: [],
		contextFiles: [],
		promptTemplates: [],
		slashCommands: [],
		sessionManager: SessionManager.inMemory(),
		bindProcessState: false,
	});

	// 멀티턴: 이전 대화는 질문 앞에 맥락으로만 붙인다(사실 근거는 이번 도구 결과에서만 — SYSTEM 규칙 6).
	const hist = (input.history ?? []) as { role: string; content: string }[];
	const prefix = hist.length
		? `[이전 대화]\n${hist.map(h => `${h.role === "user" ? "사용자" : "도우미"}: ${h.content}`).join("\n")}\n\n`
		: "";
	const seed = input.seed as { context: string; sources: Src[]; hint?: string } | undefined;
	if (seed?.context) {
		evidence.push({ tool: "seed", args: {}, context: seed.context, sources: seed.sources ?? [] });
		seed.context.split(SEP).forEach(b => seenHeads.add(head(b)));
	}
	const seedPart = seed?.context
		? `\n\n[근거]\n${seed.context}${seed.hint ? `\n\n[추가 확인 후보]\n${seed.hint}` : ""}`
		: "";
	const lastText = () => {
		const msgs = session.messages as { role: string; content?: unknown }[];
		const last = [...msgs].reverse().find(m => m.role === "assistant");
		const parts = Array.isArray(last?.content) ? (last!.content as { type: string; text?: string }[]) : [];
		return parts.filter(p => p.type === "text").map(p => p.text ?? "").join("").trim();
	};

	// 2단 프로토콜(실측: 시드 근거를 주고 한 번에 답하게 하면 9B가 '확인되지 않습니다'를 쓰면서도
	// 도구를 거의 부르지 않았다). ① 점검 턴 — 질문 항목별로 근거 유무를 표시하고 빈 곳만 도구로 메운다.
	// ② 답변 턴 — 같은 세션(도구 결과가 문맥에 남음)에서 서비스 규칙대로 최종 답변. 점검 텍스트는 버린다.
	let checkNote = "";
	let nudged = false;
	if (input.checkPrompt) {
		const before = toolCalls.length;
		await session.prompt(`${prefix}[질문]\n${input.question}${seedPart}\n\n${input.checkPrompt}`);
		checkNote = lastText();
		// 실측(2026-10-06): 점검에서 '없음'을 표시하고 "도구 사용 계획: search_regs(…)"라고 **글로만** 쓴 채
		// 실제 호출 없이 턴을 끝냈다 → 최종 답이 '확인되지 않습니다'. 그런 경우에만 1회 재촉한다.
		if (toolCalls.length === before && /없음|search_regs|read_article|list_articles/.test(checkNote)) {
			nudged = true;
			await session.prompt(
				input.nudgePrompt ??
					"계획만 쓰지 말고 지금 바로 도구를 실제로 호출해 '없음' 항목을 찾아라(설명 문장 금지). 더 찾을 곳이 없으면 '점검 완료'라고만 써라.",
			);
		}
		await session.prompt(input.finalPrompt);
	} else {
		await session.prompt(`${prefix}[질문]\n${input.question}${seedPart}`);
	}
	const answer = lastText();
	emit({ answer, checkNote, nudged, evidence, toolCalls, ms: Date.now() - t0 });
	await session.dispose?.();
} catch (e) {
	emit({ answer: "", evidence, toolCalls, ms: Date.now() - t0, error: String((e as Error)?.stack ?? e) });
}
process.exit(0);
