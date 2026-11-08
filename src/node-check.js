// Imported first by cli.js: an older Node stops here with one clear sentence instead of failing later on a missing feature.
export const MIN_NODE_MAJOR = 24;

/** null when `version` (default: this Node) is new enough, else the message to show. */
export function nodeProblem(version = process.versions.node) {
  const major = Number(String(version).split(".")[0]);
  if (major >= MIN_NODE_MAJOR) return null;
  return `nacholens 는 Node ${MIN_NODE_MAJOR} 이상이 필요합니다 (지금 v${version}). Node ${MIN_NODE_MAJOR} 로 올린 뒤 다시 실행하세요. / nacholens needs Node ${MIN_NODE_MAJOR} or newer (this is v${version}).`;
}

const problem = nodeProblem();
if (problem) {
  console.error("오류: " + problem);
  process.exit(2);
}
