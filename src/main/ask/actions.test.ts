import { describe, expect, it } from 'vitest'
import { parseAskResponse } from './actions'

describe('parseAskResponse', () => {
  it('sem bloco ===ACOES=== → answer é o raw trimado e actions vazio', () => {
    const result = parseAskResponse('  Só uma resposta em texto.  ')
    expect(result.answer).toBe('Só uma resposta em texto.')
    expect(result.actions).toEqual([])
  })

  it('com bloco válido → extrai answer sem o marcador e 1 action com os campos', () => {
    const raw =
      'Vou mover.\n===ACOES===\n[{"type":"move_status","key":"BT-1","statusName":"Em teste"}]'

    const result = parseAskResponse(raw)

    expect(result.answer).toBe('Vou mover.')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      type: 'move_status',
      key: 'BT-1',
      statusName: 'Em teste'
    })
  })

  it('JSON inválido após o marcador → actions vazio e answer sem o bloco', () => {
    const raw = 'Texto de resposta.\n===ACOES===\n[{"type": "move_status", "key": ]'

    const result = parseAskResponse(raw)

    expect(result.actions).toEqual([])
    expect(result.answer).toBe('Texto de resposta.')
  })

  it('item com type fora do enum ou sem key é descartado; itens válidos do mesmo array sobrevivem', () => {
    const raw =
      'Ok.\n===ACOES===\n' +
      JSON.stringify([
        { type: 'move_status', key: 'BT-1', statusName: 'Em teste' },
        { type: 'apagar_universo', key: 'BT-2', statusName: 'Done' },
        { type: 'move_status', statusName: 'Done' }
      ])

    const result = parseAskResponse(raw)

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]).toMatchObject({
      type: 'move_status',
      key: 'BT-1',
      statusName: 'Em teste'
    })
  })

  it('mais de 5 ações válidas → mantém só as 5 primeiras', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({
      type: 'move_status',
      key: `BT-${i + 1}`,
      statusName: 'Em teste'
    }))
    const raw = 'Muitas ações.\n===ACOES===\n' + JSON.stringify(items)

    const result = parseAskResponse(raw)

    expect(result.actions).toHaveLength(5)
  })

  it('campos extras no item são ignorados (não quebram o parse)', () => {
    const raw =
      'Ok.\n===ACOES===\n' +
      JSON.stringify([
        {
          type: 'move_status',
          key: 'BT-1',
          statusName: 'Em teste',
          extraField: 'não deveria importar'
        }
      ])

    const result = parseAskResponse(raw)

    expect(result.actions).toHaveLength(1)
    expect(result.actions[0].type).toBe('move_status')
    expect(result.actions[0].key).toBe('BT-1')
    expect(result.actions[0].statusName).toBe('Em teste')
  })
})
