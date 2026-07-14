export interface TestCase {
  id: string
  name: string
  description: string
  type: string
  status: string
  steps: string[]
  expected: string
  actual?: string
  duration?: number
}

export interface TestSection {
  id: string
  name: string
  cases: TestCase[]
  subsections?: TestSection[]
}

export namespace TestXMLGenerator {
  export function generateWhiteboxXML(projectName: string, sections: TestSection[]): string {
    const body = sections.map((item) => section(item)).join("\n")
    return `<?xml version="1.0" encoding="UTF-8"?>
<test_plan kind="whitebox" project="${escape(projectName)}" generated_at="${new Date().toISOString()}">
  <sections>
${indent(body, 4)}
  </sections>
</test_plan>
`
  }

  export function generateBlackboxXML(projectName: string, userStories: string[], sections: TestSection[]): string {
    const stories = userStories.map((item, idx) => `    <story id="US-${idx + 1}">${escape(item)}</story>`).join("\n")
    const body = sections.map((item) => section(item)).join("\n")
    return `<?xml version="1.0" encoding="UTF-8"?>
<test_plan kind="blackbox" project="${escape(projectName)}" generated_at="${new Date().toISOString()}">
  <user_stories>
${stories || "    <story id=\"US-1\">No user stories provided</story>"}
  </user_stories>
  <sections>
${indent(body, 4)}
  </sections>
</test_plan>
`
  }

  export function generateFromRequirements(
    projectName: string,
    requirements: string[],
    type: "whitebox" | "blackbox",
  ): string {
    const sections = requirements.map((item, idx) => {
      const id = `SEC-${idx + 1}`
      return {
        id,
        name: `Requirement ${idx + 1}`,
        cases: [
          {
            id: `TC-${idx + 1}-1`,
            name: `Validate requirement ${idx + 1}`,
            description: item,
            type,
            status: "pending",
            steps: [
              `Prepare test data for requirement ${idx + 1}`,
              `Execute flow for requirement ${idx + 1}`,
              "Capture logs and outputs",
            ],
            expected: "Requirement behavior is satisfied",
          },
        ],
      } satisfies TestSection
    })
    if (type === "whitebox") return generateWhiteboxXML(projectName, sections)
    return generateBlackboxXML(projectName, requirements, sections)
  }
}

function section(item: TestSection): string {
  const cases = item.cases.map((value) => testcase(value)).join("\n")
  const subs = (item.subsections ?? []).map((value) => section(value)).join("\n")
  const tail = subs ? `\n${indent(`<subsections>\n${indent(subs, 2)}\n</subsections>`, 2)}` : ""
  return `<section id="${escape(item.id)}" name="${escape(item.name)}">\n${indent(cases, 2)}${tail}\n</section>`
}

function testcase(item: TestCase): string {
  const steps = item.steps.map((value, idx) => `      <step index="${idx + 1}">${escape(value)}</step>`).join("\n")
  const actual = item.actual ? `\n    <actual>${escape(item.actual)}</actual>` : ""
  const duration = item.duration !== undefined ? `\n    <duration>${item.duration}</duration>` : ""
  return `<case id="${escape(item.id)}" name="${escape(item.name)}" type="${escape(item.type)}" status="${escape(item.status)}">\n    <description>${escape(item.description)}</description>\n    <steps>\n${steps}\n    </steps>\n    <expected>${escape(item.expected)}</expected>${actual}${duration}\n  </case>`
}

function escape(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function indent(input: string, width: number): string {
  const pad = " ".repeat(width)
  return input
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n")
}
