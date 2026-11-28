// Lessons are one-line facts the agent learned about a service, kept at the end of its notes under a "Lessons:" heading.
// This is the only way they are written: nothing else of the service changes.

import { findKeys } from "@/lib/services/key-patterns"

export const LESSONS_HEADING = "Lessons:"
export const MAX_LESSON_LENGTH = 300
export const MAX_NOTES_LENGTH = 20000

export type LessonResult = { notes: string; added: boolean } | { refused: string }

/** The lesson as one line, or why it can't be kept. */
export function cleanLesson(lesson: string): string | { refused: string } {
  const line = lesson.replace(/\s+/g, " ").trim().replace(/^[-*•]\s+/, "")
  if (!line) return { refused: "The lesson is empty." }
  if (line.length > MAX_LESSON_LENGTH) return { refused: `The lesson must be at most ${MAX_LESSON_LENGTH} characters. Shorten it to one sentence.` }
  if (findKeys(line).length > 0) return { refused: "A lesson can't contain credentials." }
  return line
}

/** The notes with the lesson added under "Lessons:". An exact repeat changes nothing, and the oldest lessons go first when the notes are full. */
export function addLesson(notes: string, lesson: string): LessonResult {
  const cleaned = cleanLesson(lesson)
  if (typeof cleaned !== "string") return cleaned
  const line = `- ${cleaned}`

  const lines = notes.split("\n")
  const heading = lines.findIndex((text) => text.trim() === LESSONS_HEADING)
  if (heading < 0) {
    const text = `${notes.trimEnd() ? `${notes.trimEnd()}\n\n` : ""}${LESSONS_HEADING}\n${line}`
    return text.length > MAX_NOTES_LENGTH ? { refused: "The service's notes are full." } : { notes: text, added: true }
  }

  let end = heading + 1
  while (end < lines.length && lines[end].startsWith("- ")) end++
  const existing = lines.slice(heading + 1, end)
  if (existing.some((text) => text.trim() === line)) return { notes, added: false }

  const before = lines.slice(0, heading + 1)
  const after = lines.slice(end)
  const kept = [...existing, line]
  const join = () => [...before, ...kept, ...after].join("\n")
  while (join().length > MAX_NOTES_LENGTH && kept.length > 1) kept.shift()
  const text = join()
  return text.length > MAX_NOTES_LENGTH ? { refused: "The service's notes are full." } : { notes: text, added: true }
}
