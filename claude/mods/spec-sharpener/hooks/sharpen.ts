// Detects a large, open build request. No model call: the main model, with the full context, asks.

const BUILD = /\b(build|create|implement|make|design|ship|launch|develop|rewrite|re-?architect|architect|set ?up|scaffold|port|redesign|overhaul)\b/i
const SCOPE =
  /\b(app|application|product|platform|system|service|site|website|landing|page|mvp|company|startup|pipeline|engine|sdk|cli|tool|dashboard|api|backend|frontend|agent|bot|extension|plugin|mod|game|feature|integration|workflow|infra|deployment)s?\b/i
const SMALL = /\b(fix|typo|rename|bump|tiny|quick(ly)?|one-?liner|small tweak|just (add|change|update|rename))\b/i
const OPT_OUT = /\b(no questions|don'?t ask|just do it|go ahead|proceed|as discussed|as planned|continue from)\b/i
const ALREADY_SPECCED = /\b(DONE|acceptance criteria|definition of done|must:|requirements:)\b/

export function isOpenBuild(text: string): boolean {
  const t = text.trim()
  if (t.startsWith('/') || t.length < 12) return false
  if (OPT_OUT.test(t) || SMALL.test(t) || ALREADY_SPECCED.test(t)) return false
  return BUILD.test(t) && SCOPE.test(t)
}

export const SHARPEN_NOTE =
  'spec-sharpener: this reads as a large build. Before any tool call that changes files, check whether different readings would lead to materially different work ' +
  '(audience, scope, stack, what DONE means, constraints). If they would and the conversation does not settle it, ask at most 3-4 pointed questions in ONE ' +
  'AskUserQuestion call, recommended option first, then wait. If it is already settled, state your reading in one line and proceed. Never ask about defaults you can pick.'
