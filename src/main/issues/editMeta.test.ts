import { describe, expect, it } from 'vitest'
import { mapEditMeta } from './editMeta'
import type { JiraEditMetaResponse } from '../jira/types'

describe('mapEditMeta', () => {
  it('editmeta completo (priority + customfield_10500 Severidade + SP field) → tudo mapeado', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: {
          name: 'Priority',
          allowedValues: [
            { id: '1', name: 'Alta' },
            { id: '2', name: 'Média' }
          ]
        },
        customfield_10500: {
          name: 'Severidade',
          allowedValues: [
            { id: '10', name: 'Crítica', value: 'Crítica' },
            { id: '11', name: 'Baixa', value: 'Baixa' }
          ]
        },
        customfield_10016: { name: 'Story point estimate' }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: 'customfield_10016',
      currentPriority: 'Média',
      currentSeverity: 'Crítica',
      timeSpent: '3h',
      originalEstimate: '1d'
    })

    expect(result.storyPointsEditable).toBe(true)
    expect(result.priority).toEqual({
      editable: true,
      current: 'Média',
      options: [
        { id: '1', name: 'Alta' },
        { id: '2', name: 'Média' }
      ]
    })
    expect(result.severity).toEqual({
      fieldId: 'customfield_10500',
      name: 'Severidade',
      current: 'Crítica',
      options: [
        { id: '10', value: 'Crítica' },
        { id: '11', value: 'Baixa' }
      ]
    })
    expect(result.timeSpent).toBe('3h')
    expect(result.originalEstimate).toBe('1d')
  })

  it('editmeta com a chave timetracking → timeTrackingEditable true', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: { name: 'Priority', allowedValues: [{ id: '1', name: 'Alta' }] },
        timetracking: { name: 'Time Tracking' }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.timeTrackingEditable).toBe(true)
  })

  it('editmeta sem a chave timetracking → timeTrackingEditable false', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: { name: 'Priority', allowedValues: [{ id: '1', name: 'Alta' }] }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.timeTrackingEditable).toBe(false)
  })

  it('sem campo de severidade no editmeta → severity null', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: { name: 'Priority', allowedValues: [{ id: '1', name: 'Alta' }] }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: 'Alta',
      currentSeverity: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.severity).toBeNull()
  })

  it('SP field id nulo (não configurado no site) → storyPointsEditable false', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        customfield_10016: { name: 'Story point estimate' }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.storyPointsEditable).toBe(false)
  })

  it('SP field id presente mas ausente do editmeta (não editável neste card/tela) → false', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: { name: 'Priority' }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: 'customfield_10016',
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.storyPointsEditable).toBe(false)
  })

  it('allowedValue de priority sem id é descartada', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: {
          name: 'Priority',
          allowedValues: [{ name: 'Sem id' }, { id: '2', name: 'Média' }]
        }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.priority.options).toEqual([{ id: '2', name: 'Média' }])
  })

  it('allowedValue de priority sem name também é descartada', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: {
          name: 'Priority',
          allowedValues: [{ id: '9' }, { id: '2', name: 'Média' }]
        }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.priority.options).toEqual([{ id: '2', name: 'Média' }])
  })

  it('severity sem allowedValues → options vazio', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        customfield_10500: { name: 'Severity' }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.severity).toEqual({
      fieldId: 'customfield_10500',
      name: 'Severity',
      current: null,
      options: []
    })
  })

  it('severity value ausente usa name', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        customfield_10500: {
          name: 'Severidade',
          allowedValues: [{ id: '10', name: 'Crítica' }]
        }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.severity?.options).toEqual([{ id: '10', value: 'Crítica' }])
  })

  it('sem raw.fields (undefined) → nada editável e severity null', () => {
    const result = mapEditMeta({
      raw: {},
      storyPointsFieldId: 'customfield_10016',
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.storyPointsEditable).toBe(false)
    expect(result.priority).toEqual({ editable: false, current: null, options: [] })
    expect(result.severity).toBeNull()
    expect(result.timeTrackingEditable).toBe(false)
  })

  it('campo cuja chave é "priority" mas cujo nome casa /sever/i não é tratado como severidade', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        priority: { name: 'Severity', allowedValues: [{ id: '1', name: 'Alta' }] }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.severity).toBeNull()
    expect(result.priority.editable).toBe(true)
  })

  it('currentSeverity omitido (não passado) → severity.current null', () => {
    const raw: JiraEditMetaResponse = {
      fields: {
        customfield_10500: { name: 'Severidade', allowedValues: [{ id: '1', name: 'Alta' }] }
      }
    }

    const result = mapEditMeta({
      raw,
      storyPointsFieldId: null,
      currentPriority: null,
      timeSpent: null,
      originalEstimate: null
    })

    expect(result.severity?.current).toBeNull()
  })
})
