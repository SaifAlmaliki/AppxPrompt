/** One numbered option in an interview question. */
export type InterviewChoice = { n: number; text: string }

export type ChatPiece =
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "choices"; items: InterviewChoice[] }

const CHOICE_LINE = /^\s*(\d+)[.)]\s+(\S.*?)\s*$/
const BULLET_LINE = /^\s*[-*•]\s+(\S.*?)\s*$/

/**
 * Splits an assistant reply into paragraphs, dash lists, and numbered choices.
 * When `numberBullets` is set, a single dash list of two or more lines becomes
 * choices 1, 2, 3, so an interview question can be answered with a number.
 */
export function chatPieces(text: string, numberBullets = false): ChatPiece[] {
  const pieces: ChatPiece[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let choices: InterviewChoice[] = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    pieces.push({ type: "paragraph", text: paragraph.join("\n") })
    paragraph = []
  }
  const flushList = () => {
    if (list.length === 0) return
    pieces.push({ type: "list", items: list })
    list = []
  }
  const flushChoices = () => {
    if (choices.length === 0) return
    pieces.push({ type: "choices", items: choices })
    choices = []
  }

  for (const line of text.split("\n")) {
    const choice = CHOICE_LINE.exec(line)
    const bullet = BULLET_LINE.exec(line)
    if (choice) {
      flushParagraph()
      flushList()
      choices.push({ n: Number(choice[1]), text: choice[2] })
    } else if (bullet) {
      flushParagraph()
      flushChoices()
      list.push(bullet[1])
    } else if (line.trim() === "") {
      flushParagraph()
      flushList()
      flushChoices()
    } else {
      flushList()
      flushChoices()
      paragraph.push(line)
    }
  }
  flushParagraph()
  flushList()
  flushChoices()

  if (!numberBullets) return pieces
  const lists = pieces.filter((piece) => piece.type === "list")
  const hasChoices = pieces.some((piece) => piece.type === "choices")
  if (hasChoices || lists.length !== 1 || lists[0].type !== "list" || lists[0].items.length < 2) return pieces
  return pieces.map((piece) =>
    piece.type === "list"
      ? { type: "choices" as const, items: piece.items.map((item, index) => ({ n: index + 1, text: item })) }
      : piece
  )
}

/** Numbers in a reply such as "1", "1, 3", or "1 and 3". Null when the text is anything else. An empty reply is an empty list. */
export function numberReply(text: string): number[] | null {
  const trimmed = text.trim().replace(/[\s,.;]+$/g, "")
  if (!trimmed) return []
  const joined = /^\d+(\s*(?:,|&|and)\s*\d+)*$/i
  const spaced = /^\d+(\s+\d+)*$/
  if (!joined.test(trimmed) && !spaced.test(trimmed)) return null
  return [...trimmed.matchAll(/\d+/g)].map((match) => Number(match[0]))
}

function choicesIn(text: string, numberBullets: boolean): InterviewChoice[] {
  return chatPieces(text, numberBullets).flatMap((piece) => (piece.type === "choices" ? piece.items : []))
}

/**
 * Turns a number-only interview reply into the option text, for the model.
 * The chat still shows the number the person sent.
 */
export function expandNumberReply(userText: string, assistantText: string, assistantHasPlan: boolean): string {
  const choices = choicesIn(assistantText, !assistantHasPlan)
  if (choices.length === 0) return userText
  const trimmed = userText.trim().replace(/[.!]+$/g, "").trim()
  if (/^(all|all of them|every one|everything|each|each of them)$/i.test(trimmed)) {
    return choices.map((choice) => choice.text).join("\n")
  }
  if (/^both$/i.test(trimmed) && choices.length === 2) {
    return choices.map((choice) => choice.text).join("\n")
  }
  const picked = numberReply(userText)
  if (!picked || picked.length === 0) return userText
  const lines: string[] = []
  for (const n of picked) {
    const choice = choices.find((item) => item.n === n)
    if (!choice) return userText
    lines.push(choice.text)
  }
  return lines.join("\n")
}
