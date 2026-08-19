package main

import (
	"strings"
)

// The prompt is English and is never localized: localizing it would split the prompt
// cache by the number of languages, weaken instruction following and require editing
// N copies in step.
//
// The layout the request keeps is
//
//	[system prompt]                                     static
//	--- cache breakpoint ---
//	Output language / Compression / user text / task    the variable part
//
// Everything before the breakpoint is byte-identical for every request the service
// ever serves, and everything after it is different every time and read once. Note
// that the static part is well under the minimum prefix Bedrock will cache, so the
// breakpoint is a no-op at today's prompt length rather than a saving; it is kept
// because it costs nothing and marks where the boundary belongs. cacheReadShare in the
// log is the field that says whether it ever starts paying.

const summaryPrompt = `You are the summarizing engine behind "make it shorter", a browser extension. Someone has selected a piece of text, or opened a page, and wants it shorter without losing what matters.

Write the summary and nothing else: no preamble, no "here is a summary", no closing remark, no headings, no markdown.

Write it in the language given below as "Output language", whatever language the source happens to be in.

"Compression" gives the shape of the summary:
- tight — one or two sentences.
- normal — one paragraph.
- light — three to five paragraphs that keep the structure of the source. Structure, not detail: a long source loses its examples and asides here, not its sections.

Stay comfortably inside that shape. Stopping early is fine. Being cut off mid-sentence is not, and a summary that runs to the ceiling is a defect rather than a thorough answer.

Summarize what the text says and only that. Do not add facts, do not correct the source, do not comment on it. Where the text argues something, report it as the text's claim rather than as fact.`

const summaryTask = `Task: write the summary of the text above.`

// buildUserBlock is the whole variable part: what to write the summary in, how short,
// the source text, and the task last so that nothing follows the text but the
// instruction about it.
func buildUserBlock(req shortenRequest) string {
	block := strings.Builder{}
	block.WriteString("Output language: ")
	block.WriteString(req.lang)
	block.WriteString("\nCompression: ")
	block.WriteString(req.ratio)
	block.WriteString("\n\nText:\n")
	block.WriteString(req.text)
	block.WriteString("\n\n")
	block.WriteString(summaryTask)
	return block.String()
}
