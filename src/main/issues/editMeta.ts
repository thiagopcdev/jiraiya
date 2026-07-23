import type { JiraEditMetaResponse } from '../jira/types'

export interface EditMetaResult {
  storyPointsEditable: boolean
  priority: {
    editable: boolean
    current: string | null
    options: Array<{ id: string; name: string }>
  }
  severity: {
    fieldId: string
    name: string
    current: string | null
    options: Array<{ id: string; value: string }>
  } | null
  timeSpent: string | null
  originalEstimate: string | null
  timeTrackingEditable: boolean
}

/**
 * Mapeia o editmeta cru do Jira no formato do contrato IPC. Função pura.
 * - storyPointsEditable: campo de story points configurado E presente no editmeta.
 * - priority: editável se 'priority' está no editmeta; opções vêm de allowedValues.
 * - severity: primeiro campo (exceto priority) cujo nome casa /sever/i.
 */
export function mapEditMeta(input: {
  raw: JiraEditMetaResponse
  storyPointsFieldId: string | null
  currentPriority: string | null
  currentSeverity?: string | null
  timeSpent: string | null
  originalEstimate: string | null
}): EditMetaResult {
  const fields = input.raw.fields ?? {}

  const storyPointsEditable =
    input.storyPointsFieldId !== null && input.storyPointsFieldId in fields

  const priorityField = fields.priority
  const priority = {
    editable: 'priority' in fields,
    current: input.currentPriority,
    options: (priorityField?.allowedValues ?? [])
      .filter((v): v is { id: string; name: string } => Boolean(v.id) && Boolean(v.name))
      .map((v) => ({ id: v.id, name: v.name }))
  }

  let severity: EditMetaResult['severity'] = null
  for (const [fieldId, def] of Object.entries(fields)) {
    if (fieldId === 'priority') continue
    if (def.name && /sever/i.test(def.name)) {
      severity = {
        fieldId,
        name: def.name,
        current: input.currentSeverity ?? null,
        options: (def.allowedValues ?? [])
          .filter((v) => Boolean(v.id) && Boolean(v.value ?? v.name))
          .map((v) => ({ id: v.id as string, value: (v.value ?? v.name) as string }))
      }
      break
    }
  }

  return {
    storyPointsEditable,
    priority,
    severity,
    timeSpent: input.timeSpent,
    originalEstimate: input.originalEstimate,
    timeTrackingEditable: 'timetracking' in fields
  }
}
