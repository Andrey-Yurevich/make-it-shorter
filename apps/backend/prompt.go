package main

import (
	"fmt"
	"strings"
)

// The prompt is English and is never localized: localizing it would split the prompt
// cache by the number of languages, weaken instruction following and require editing
// N copies in step.
//
// Everything static is assembled once at start and stays byte-identical between
// requests. The layout the request must keep is
//
//	[system prompt + catalog table + tool description]   static
//	--- cache breakpoint 1 ---
//	Output language / Compression / user text            shared by both phases
//	--- cache breakpoint 2 ---
//	<phase task>                                         the variable part
//
// The second breakpoint is what phase 1 writes and all five phase 2 calls read.
// Without it the source text — up to 30 000 characters — would be paid for at full
// price six times instead of once.

const toolName = "suggest_actions"

const summaryPrompt = `You are the summarizing engine behind "make it shorter", a browser extension. Someone has selected a piece of text, or opened a page, and wants it shorter without losing what matters.

Write the summary and nothing else: no preamble, no "here is a summary", no closing remark, no headings, no markdown.

Write it in the language given below as "Output language", whatever language the source happens to be in.

"Compression" gives the shape of the summary:
- tight — one or two sentences.
- normal — one paragraph.
- light — three to five paragraphs that keep the structure of the source. Structure, not detail: a long source loses its examples and asides here, not its sections.

Stay comfortably inside that shape. Stopping early is fine. Being cut off mid-sentence is not, and a summary that runs to the ceiling is a defect rather than a thorough answer.

Summarize what the text says and only that. Do not add facts, do not correct the source, do not comment on it. Where the text argues something, report it as the text's claim rather than as fact.`

// The %d is the button ceiling. It carries no percent sign of its own, and anything
// added here must not introduce one.
const toolPromptTemplate = `After the summary, you may call the tool ` + toolName + ` once. It proposes the follow-up buttons the extension shows under the summary. You choose ids from the list below and never write button labels: the wording lives in the extension.

Propose at most %d ids, and fewer whenever fewer will do. Propose only what this particular text can actually support, and order them by what serves the reader best.

Do not call the tool at all when there is nothing worth clarifying — the text is too short, incoherent, machine noise, a navigation stub, or has no subject of its own. Proposing nothing is a valid and often correct outcome. A guessed set of buttons is worse than none, because every button promises an answer the text cannot give.

Actions available, as "id — when it fits":
`

const phase1Task = `Task: write the summary of the text above, then decide whether to call ` + toolName + `.`

const phase1TaskNoTool = `Task: write the summary of the text above.`

// buildStaticPrompt is the whole static part: the summarizing rules plus, when the
// catalog has anything in it, the tool rules and the id -> description table.
//
// The ceiling comes from the global MAX_ACTIONS and never from the value resolved for
// one device. It sits before the first cache breakpoint, so a per-device number here
// would give every client its own prefix and its own cache — the same reason the tool
// schema uses the global ceiling. A device with a lower ceiling is served by the cut in
// filterActionIDs instead, which happens before phase 2 and so costs no model calls.
func buildStaticPrompt(cat *buttonCatalog) string {
	if len(cat.activeIDs) == 0 {
		return summaryPrompt
	}
	toolPrompt := fmt.Sprintf(toolPromptTemplate, cfg.maxActions)
	return summaryPrompt + "\n\n" + toolPrompt + cat.descriptionTable
}

// buildSharedBlock is everything both phases have in common, and it must end right
// before the second cache breakpoint. Anything phase-specific belongs after it.
func buildSharedBlock(req summarizeRequest) string {
	block := strings.Builder{}
	block.WriteString("Output language: ")
	block.WriteString(req.lang)
	block.WriteString("\nCompression: ")
	block.WriteString(req.ratio)
	block.WriteString("\n\nText:\n")
	block.WriteString(req.text)
	return block.String()
}

// buildAnswerTask is the phase 2 task: the pressed button's instruction from the
// catalog. The summary from phase 1 is deliberately not included — the model answers
// from the source text, not from its own compression of it, where the answer may
// simply not be present.
func buildAnswerTask(instruction string) string {
	return `Task: the reader has pressed a follow-up button under the summary of the text above. Answer it from that text.

Follow-up: ` + instruction + `

Write in the output language named above. Keep it to a few sentences, a short paragraph at most: plain prose, no preamble, no repetition of the summary. If the text above does not carry the answer, say so in one sentence instead of guessing. Do not call any tool.`
}
