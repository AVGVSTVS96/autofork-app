import { createHash } from "node:crypto"

export const NOTE = "fork-readme"

export const withNote = (readme: string, upstream: string) => {
  if (!readme.trim() || readme.includes("autofork.com")) return undefined
  const eol = readme.includes("\r\n") ? "\r\n" : "\n"
  const lines = readme.split(eol)
  const titled = /^﻿?#\s/.test(lines[0]!)
  const name = (titled && lines[0]!.match(/^﻿?#\s+([^[\]<>`*_!]+?)[\s#]*$/)?.[1]) || upstream.split("/")[1]
  const note = `> A personal fork of [${name}](https://github.com/${upstream}) that updates itself with [autofork](https://autofork.com). Its changes, each described in plain words, are in [\`.autofork/\`](.autofork).`
  const at = titled ? 1 : 0
  const block = titled ? ["", note, ...(lines[1]?.trim() ? [""] : [])] : [note, ""]
  return [...lines.slice(0, at), ...block, ...lines.slice(at)].join(eol)
}

export const noteDoc = (name: string) => `One line under the README's title says this is a personal fork of ${name} that updates itself with autofork, linking ${name}, https://autofork.com and this fork's \`.autofork/\` folder. The rest of the README stays as upstream wrote it.

To drop the line, delete it from the README and delete this folder, in the same commit.
`

const blob = (text: string) => {
  const bytes = Buffer.from(text)
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex")
}

const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? []

export const diff = (path: string, before: string, after: string) => {
  const a = lines(before)
  const b = lines(after)
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  const from = Math.max(0, start - 3)
  const to = Math.min(a.length, a.length - end + 3)
  const mark = (sign: string) => (line: string) => (line.endsWith("\n") ? `${sign}${line}` : `${sign}${line}\n\\ No newline at end of file\n`)
  return [
    `diff --git a/${path} b/${path}\n`,
    `index ${blob(before)}..${blob(after)} 100644\n`,
    `--- a/${path}\n`,
    `+++ b/${path}\n`,
    `@@ -${from + 1},${to - from} +${from + 1},${to - from + b.length - a.length} @@\n`,
    ...a.slice(from, start).map(mark(" ")),
    ...a.slice(start, a.length - end).map(mark("-")),
    ...b.slice(start, b.length - end).map(mark("+")),
    ...a.slice(a.length - end, to).map(mark(" ")),
  ].join("")
}
