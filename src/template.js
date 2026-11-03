// Empty model template for a repo that has none yet. Every value an author must supply starts
// with "TODO"; validateModel reports each one with its JSON path, so the error output is the checklist.
export function makeTemplate({ slug = null, commit, name = null }) {
  const id = (name ?? "my-product").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "") || "my-product";
  const ev = (what) => [{ file: `TODO: ${what} 가 있는 파일 (저장소 기준 상대 경로)`, lines: [1, 1], contains: `TODO: 그 줄 범위에 실제로 있는 문자열(선택, 지우면 검사 생략)` }];
  return {
    schemaVersion: 1,
    product: {
      id,
      name: `TODO: 제품 이름`,
      description: `TODO: 한 줄 설명 — 사용자가 무엇을 하는 제품이고 요청이 어디를 거치는지`,
    },
    source: { repo: slug ?? `TODO: owner/repo`, commit },
    components: [
      { id: "client", kind: "client", label: "TODO: 클라이언트 이름\nTODO: 부제", detail: "TODO: 이 컴포넌트가 하는 일 (코드에서 확인한 것만)", evidence: ev("클라이언트가 API 를 호출하는 코드") },
      { id: "gateway", kind: "gateway", label: "TODO: 게이트웨이 이름\nTODO: 부제", detail: "TODO: 요청을 어디로 넘기는지 (게이트웨이가 없으면 이 컴포넌트와 연결·via 를 지우세요)", evidence: ev("게이트웨이/프록시 설정·코드") },
      { id: "server", kind: "service", label: "TODO: 서버 이름\nTODO: 부제", detail: "TODO: 서버가 하는 일", evidence: ev("요청 핸들러 진입점") },
    ],
    links: [
      { a: "client", b: "gateway", label: "TODO: 어떤 통신인지(예: HTTPS /api/*)", evidence: ev("연결을 보여주는 코드·설정") },
      { a: "gateway", b: "server", label: "TODO: 어떤 통신인지(예: 서비스 바인딩)", evidence: ev("연결을 보여주는 코드·설정") },
    ],
    useCases: [
      {
        id: "first-use-case",
        title: "TODO: 유즈케이스 이름 (사용자가 하는 행동, 예: 관리자 로그인)",
        summary: "TODO: 한두 문장 요약",
        trigger: "TODO: 진입 요청 (예: GET /api/session)",
        steps: [
          { id: "request", kind: "request", from: "client", via: ["gateway"], to: "server", label: "TODO: 짧은 제목", narration: "TODO: 사람이 읽는 문장 — 무슨 일이 일어나는가", request: "TODO: 요청 요약", evidence: ev("이 단계를 보여주는 코드") },
          { id: "response", kind: "response", from: "server", via: ["gateway"], to: "client", label: "TODO: 짧은 제목", narration: "TODO: 사람이 읽는 문장", response: "TODO: 응답 요약", evidence: ev("응답을 만드는 코드") },
        ],
      },
    ],
  };
}
