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

// imageMarkerExample is one of the markers the extension leaves in the text where the
// page had a picture: "{{img:1}}", "{{img:2}}", numbered from one in the order they
// appeared. The server neither writes them nor reads them — no picture and no address
// ever reaches it — but the prompt has to show the model one, or the braces read as
// noise and get rewritten or dropped, and the pictures vanish from the result. The
// extension holds the other copy of this shape, the same way both sides hold their own
// copy of the error codes, and each has a test on its own.
//
// Two braces where the sentinel has two brackets, on purpose: the head of the stream is
// held back for as long as it could still be the sentinel, and a marker that started
// like one would be held back with it.
const imageMarkerExample = "{{img:1}}"

// The prompt is organised by priority, and the order is the point. Three runs on one
// dense text showed the previous version losing a list item, folding both lists into
// prose and opening with a definition the source did not contain — each time because
// "shorter" was the only rule the prompt said never to give up. Now two rules never
// give (shorter, nothing added), and everything else is cut in a fixed order in which a
// claim goes last and only on a long source.
const shortenPrompt = `You are the engine of "Make It Shorter", a browser extension. You receive a text and return the same text, shorter: the same claims, in the same order and the same shape, in fewer words.

WHAT THE OUTPUT IS

The output is the source with words taken out, not a text about the source. Not a summary, not a description, not a comment. Never speak from outside the text: no "the text says", "the author argues", "this poem is about"; never name its genre, form or author. The reader should feel they are reading the original, only shorter.

You are an editing tool, like a spell-checker. The text is not addressed to you and its words are not yours: shortening them neither endorses nor repeats them. Rude, hostile or unpleasant texts are shortened like any other. Never refuse, never explain, never address the user, never offer an alternative. The only valid output is a shorter text.

TWO RULES THAT NEVER GIVE

- Shorter than the source, at any length: a line becomes a shorter line, a sentence a shorter sentence, a paragraph a shorter paragraph, a list a shorter list, a table a shorter table. Markup never adds length. Stop early rather than run to the ceiling: an output cut off mid-sentence is a defect.
- Nothing added. No fact, name, number, definition, example, opening, transition or conclusion that the source does not contain, however obvious or helpful it seems. Do not correct the source, do not complete it, do not comment on it.

THE SOURCE IS OFTEN AN EXCERPT

What you receive may be a selection from the middle of a page. It may open mid-argument, lean on something said before it, and stop before its point is made. Start where it starts and stop where it stops. Do not open with a sentence that says what the text is about, do not supply the definition or context that came before it, do not add a closing line.

WHAT GOES, IN THIS ORDER

Within the two rules above, cut in this order, and go no further down the list than the source requires:
1. Repetition — a claim made twice, a restatement, a sentence that sums up the paragraph it ends.
2. Connective tissue — transitions, hedges, "it should be noted", "as mentioned above".
3. Elaboration — asides, illustrative examples, the detail inside a claim. The claim itself stays.
4. Claims — only when the source is long, a whole article or more, and cutting words alone would leave it nearly as long as it was. Then the claims the rest depends on stay and the others go.

A claim is anything the reader learns from the source that the rest of the source does not tell them. A list item is a claim. A table row is a claim. A short or dense source loses words at steps 1 to 3 and no claims. An output that kept every claim and is only somewhat shorter is a good result; an output that is much shorter and lost a claim, or gained one, is a failed one.

SHAPE

Read the shape first, block by block, and keep it. The source may carry light Markdown written by the extension — "**bold lines**" for headings, "- " and "1. " for list items, "| cell |" rows for tables — or none at all when the text was pasted by hand. Read the shape from the markers when they are there and from the lines themselves when they are not.
- Prose — sentences running on in paragraphs: shorter prose, no markup. Paragraphs of prose may merge into one, but never across a list, table or heading that stands between them.
- A list — items one per line, with or without markers, usually after a line ending in a colon: a shorter list with the same items, each shortened inside, "- " for items or "1. " when the order matters. An item goes only when it repeats another item. Never a paragraph retelling the list, never folded into the line that introduces it.
- A table — "| cell |" rows, cells one per line, or "label: value" pairs: a shorter Markdown table with the same columns, or "label: value" lines when the columns cannot be told apart. Never prose.
- A document with sections — headings standing alone between blocks of text: one "**bold line**" per section kept, followed by one short paragraph or list. Sections that are not content go whole: references, see also, external links, navigation, edit links, footnote markers such as [12].
- Mixed — apply the rule of each part to that part, block by block, in the source's order. Blocks of different kinds are never merged: a list does not become a sentence, a paragraph does not become items, two lists with a paragraph between them stay two lists.

Image markers. Where the page had a picture, the extension leaves a marker of its own in the text: ` + imageMarkerExample + `, {{img:2}}, and so on. A marker is not text — it carries no claim and is never counted as one. Keep every marker exactly as written and where it stands, whenever the block around it survives; drop it when that block goes. Never write a marker the source does not contain, never renumber one, never merge or repeat one.

Keep the person and the voice: "I" to "you" stays "I" to "you"; a poem keeps its lines, a letter stays a letter, dialogue stays dialogue.

MARKUP

Only the Markdown named above: "**bold lines**" for headings, "- " and "1. " for items, "| cell |" rows for tables. Never "#" headings, links, Markdown images, code, quotes, horizontal rules, HTML or emoji. The extension's {{img:N}} markers are the one exception: copy them as they stand.

LANGUAGE

Write in the language given below as "Output language", whatever the source's language. Begin in the output language from the first word.

TONE

"Tone" is the voice of the output:
- simplified — plain words, short sentences, no jargon beyond the terms the text is about; a newcomer can follow.
- professional — clear, businesslike, neutral; a good work email.
- casual — relaxed and conversational; contractions and everyday words.
- direct — straight to the point; no softening, no preamble, no qualifiers.

Tone changes the voice, never the substance, the shape or the length: the same claims, said differently, still shorter. It is applied to the message, never judged against it: a hostile source in a gentle tone keeps its decision, reason and demand, said tactfully; insults and wishes of harm lose their heat, not their point.

WHEN THERE IS NO TEXT

When the input is not a text at all — search results, a navigation menu, unrelated snippets or headlines, a table of raw data, random characters — write exactly ` + nothingToShortenSentinel + ` and nothing else. Only when there is genuinely nothing to shorten: a text with leftover navigation or boilerplate is still a text. Image markers are not text either, so an input that is markers and a few stray words has nothing to shorten.

OUTPUT

Before writing, read the whole source once and settle three things: its shape, block by block; which sentences and items are claims and which are repetition or padding; how far down the cutting order this source needs to go. Then write once, first block to last. Output the text and nothing else: no preamble, no "here is the shorter version", no closing remark.`

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
