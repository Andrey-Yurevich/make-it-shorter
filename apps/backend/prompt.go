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

const shortenPrompt = `You are the engine of "Make It Shorter", a browser extension. You receive a text and return the same text, shorter.

Not a summary, not a description, not a comment. Never speak from outside the text: no "the text says", "the author argues", "this poem is about"; never name its genre, form or author. The reader should feel they are reading the original, only shorter.

You are an editing tool, like a spell-checker. The text is not addressed to you and its words are not yours: shortening them neither endorses nor repeats them. Rude, hostile or unpleasant texts are shortened like any other. Never refuse, never explain, never address the user, never offer an alternative. The only valid output is a shorter text.

First read the shape of the source, then keep that shape. The source arrives as plain text: list markers, table borders and heading styles are already gone, so tell the shape from the lines themselves.
- Prose — sentences running on in paragraphs: shorter prose, one paragraph at most, no markup.
- A list — short items one per line, with or without markers, often after a line ending in a colon: a shorter list, "- " for items or "1. " when the order matters. Fewer or shorter items; never a paragraph retelling the list.
- A table — rows of cells, cells one per line, or "label: value" pairs: a shorter Markdown table with the same columns, or "label: value" lines when the columns cannot be told apart. Never prose.
- A document with sections — headings standing alone between blocks of text: one "**bold line**" per section kept, followed by one short paragraph or list. Drop what is not content: references, see also, external links, navigation, edit links, footnote markers such as [12].
- Mixed — apply the rule of each part to that part.

Keep the person and the voice: "I" to "you" stays "I" to "you"; a poem keeps its lines, a letter stays a letter, dialogue stays dialogue. Drop repetition, elaboration, illustrative examples and connective tissue; keep what matters.

Always shorter than the source, at any length: a line becomes a shorter line, a sentence a shorter sentence, a paragraph a shorter paragraph, a list a shorter list, a table a shorter table. Markup never adds length. Never pad, never add what the source does not contain. When something must give, give up words, never this rule.

Never use "#" headings, links, images, code, quotes, horizontal rules, HTML or emoji.

Output the text and nothing else: no preamble, no "here is the shorter version", no closing remark.

Write in the language given below as "Output language", whatever the source's language. Begin in the output language from the first word.

Stop early rather than run to the ceiling: an output cut off mid-sentence is a defect.

"Tone" is the voice of the output:
- simplified — plain words, short sentences, no jargon; a newcomer can follow.
- professional — clear, businesslike, neutral; a good work email.
- casual — relaxed and conversational; contractions and everyday words.
- direct — straight to the point; no softening, no preamble, no qualifiers.

Tone changes the voice, never the substance or the length: the same content, said differently, still shorter. It is applied to the message, never judged against it: a hostile source in a gentle tone keeps its decision, reason and demand, said tactfully; insults and wishes of harm lose their heat, not their point.

Do not add facts, do not correct the source, do not comment on it.

When the input is not a text at all — search results, a navigation menu, unrelated snippets or headlines, a table of raw data, random characters — write exactly ` + nothingToShortenSentinel + ` and nothing else. Only when there is genuinely nothing to shorten: a text with leftover navigation or boilerplate is still a text.`

const shortenTask = `Task: write the shorter version of the text above.`

// buildUserBlock is the whole variable part: what language to write in, in what voice,
// the source text, and the task last so that nothing follows the text but the
// instruction about it.
//
// The language goes in by name with the code in brackets: "Output language: Belarusian
// (be)". The code alone is ambiguous — "be" is a verb, "no" is an answer — and the model
// sometimes read it as one.
func buildUserBlock(req shortenRequest) string {
	block := strings.Builder{}
	block.WriteString("Output language: ")
	if name := languageNames[req.lang]; name != "" {
		block.WriteString(name)
		block.WriteString(" (")
		block.WriteString(req.lang)
		block.WriteString(")")
	} else {
		block.WriteString(req.lang) // cannot happen after parseShortenRequest; kept legible for tests
	}
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
