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
//	Output language / Tone / user text / task           the variable part
//
// Everything before the breakpoint is byte-identical for every request the service
// ever serves, and everything after it is different every time and read once. Note
// that the static part is well under the minimum prefix Bedrock will cache, so the
// breakpoint is a no-op at today's prompt length rather than a saving; it is kept
// because it costs nothing and marks where the boundary belongs. cacheReadShare in the
// log is the field that says whether it ever starts paying.

// nothingToShortenSentinel is the one thing the model writes instead of a shorter text
// when the input is not a text at all: a page of search results, a menu, noise. The
// server holds the first characters of the stream back until it can tell whether they
// are this, and answers nothing_to_shorten instead of forwarding it. The string has to
// be something no real text starts with.
const nothingToShortenSentinel = "[[NOTHING_TO_SHORTEN]]"

const shortenPrompt = `You are the engine behind "make it shorter", a browser extension. Someone has selected a piece of text, or opened a page, and wants that text shorter.

Your output is the same text, shorter. It is not a summary, not a description of the text and not a comment on it. Nothing is said from outside the text: never name its genre, form or author, never write "the text says", "the author argues", "this poem is about". Whoever reads your output should feel they are reading the original, only a shorter version of it.

Keep what the text is. Prose stays prose, a poem stays a poem and keeps its lines, a letter stays a letter, a list stays a list, dialogue stays dialogue. Keep the person and the voice: if the source speaks as "I" to a "you", so does the output. Keep what matters and drop what does not: repetition, elaboration, examples that only illustrate, connective tissue.

The output is always shorter than the source, whatever the source's length. A single line comes back as a shorter line, a sentence as a shorter sentence, a paragraph as a shorter paragraph, an article as one paragraph. Never pad, never explain, never add anything the source does not contain. When something has to give, give up words, never this rule.

Write the output and nothing else: no preamble, no "here is the shorter version", no closing remark, no headings, no markdown.

Write it in the language given below as "Output language", whatever language the source happens to be in.

Prose comes back as one paragraph at most. Stay comfortably inside that shape. Stopping early is fine. Being cut off mid-sentence is not, and an output that runs to the ceiling is a defect rather than a thorough answer.

"Tone" gives the voice the output is written in:
- original — keep the register of the source: a formal text stays formal, a chatty one stays chatty.
- diplomatic — tactful and balanced; soften sharp edges, take no side.
- formal — proper and reserved; full forms, no contractions, no colloquialisms.
- professional — clear, businesslike and neutral; the voice of a good work email.
- confident — assured and definite; no hedging where the source does not hedge.
- friendly — warm and approachable, as if explaining to someone you like.
- academic — precise and measured; careful about claims and what supports them.
- casual — relaxed and conversational; contractions and everyday words are fine.
- simplified — plain words and short sentences; no jargon, so that a newcomer can follow.
- bold — punchy and vivid; strong verbs, short sentences, no filler.
- empathetic — mindful of how the matter feels to the people in it; acknowledge the human side.
- direct — straight to the point; no softening, no preamble, no qualifiers.
- luxury — refined and polished; the voice of a premium brand.
- persuasive — make the case the text makes, compellingly, and only that case.
- engaging — lively and interesting to read; hold the reader without adding anything.

The tone changes the voice and never the substance or the length: the same content, said differently, and still shorter than the source.

Keep to what the text says and only that. Do not add facts, do not correct the source, do not comment on it.

When the input is not a text at all, write exactly ` + nothingToShortenSentinel + ` and nothing else. That means: a page of search results, a navigation menu, a list of unrelated snippets or headlines, a table of raw data, random characters, or anything else with no continuous content that could be made shorter. Use it only when there is genuinely nothing to shorten. A text with some navigation or boilerplate left in it is still a text, and it gets shortened.`

const shortenTask = `Task: write the shorter version of the text above.`

// buildUserBlock is the whole variable part: what language to write in, in what voice,
// the source text, and the task last so that nothing follows the text but the
// instruction about it.
func buildUserBlock(req shortenRequest) string {
	block := strings.Builder{}
	block.WriteString("Output language: ")
	block.WriteString(req.lang)
	block.WriteString("\nTone: ")
	block.WriteString(req.tone)
	block.WriteString("\n\nText:\n")
	block.WriteString(req.text)
	block.WriteString("\n\n")
	block.WriteString(shortenTask)
	return block.String()
}

// Where the first characters of the model's output stand against the sentinel. The
// stream is held back while the answer is undecided, forwarded once the sentinel is
// ruled out, and swallowed once it is found.
type sentinelVerdict int

const (
	sentinelUndecided sentinelVerdict = iota
	sentinelFound
	sentinelAbsent
)

// checkSentinel looks at everything the model has written so far. Leading whitespace
// does not count: models like to start with a newline.
func checkSentinel(written string) sentinelVerdict {
	trimmed := strings.TrimLeft(written, " \t\r\n")
	if strings.HasPrefix(trimmed, nothingToShortenSentinel) {
		return sentinelFound
	}
	if strings.HasPrefix(nothingToShortenSentinel, trimmed) {
		// Everything so far is a prefix of the sentinel (or nothing at all yet).
		return sentinelUndecided
	}
	return sentinelAbsent
}
