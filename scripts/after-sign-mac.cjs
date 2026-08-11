/**
 * Fecha o buraco de assinatura do macOS, que já entregou DMG "danificado".
 *
 * O problema: sem certificado no keychain o electron-builder simplesmente PULA
 * a assinatura ("skipped macOS application code signing — 0 identities found").
 * O que sobra é a assinatura ad-hoc que o linker põe no binário, sem selar os
 * recursos do bundle. Isso não é "não assinado", é assinado e INVÁLIDO:
 *
 *     codesign --verify --deep --strict Jiraiya.app
 *     → code has no resources but signature indicates they must be present
 *
 * Na máquina que compila não aparece nada, porque a cópia local nunca recebe
 * `com.apple.quarantine`. Em qualquer máquina que BAIXE o arquivo, o Gatekeeper
 * valida, encontra a inconsistência e manda mover para o Lixo.
 *
 * Este hook roda depois do passo de assinatura do electron-builder e garante que
 * o que sai da esteira é sempre verificável:
 *
 * - com Developer ID (TeamIdentifier presente): não toca em nada — a assinatura
 *   é a real, e a notarização é feita pelo próprio electron-builder.
 * - sem certificado: aplica assinatura ad-hoc COMPLETA (--deep), que sela os
 *   recursos. Continua sem notarização (o app cai em "desenvolvedor não
 *   verificado", que o botão direito → Abrir resolve), mas deixa de ser
 *   rejeitado como arquivo corrompido.
 *
 * Em qualquer caso o bundle é verificado no fim e o build FALHA se a verificação
 * não passar — é essa checagem que impede a regressão voltar em silêncio.
 */
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')

/** TeamIdentifier só existe em assinatura de verdade; ad-hoc não tem. */
function hasRealIdentity(appPath) {
  try {
    // codesign escreve os detalhes no stderr
    const out = execFileSync('codesign', ['-dv', '--verbose=2', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
    return /TeamIdentifier=(?!not set)/.test(out)
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`
    return /TeamIdentifier=(?!not set)/.test(out)
  }
}

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  const appName = context.packager.appInfo.productFilename
  const appPath = join(context.appOutDir, `${appName}.app`)

  if (hasRealIdentity(appPath)) {
    console.log(`  • assinatura Developer ID presente — hook não intervém  app=${appName}.app`)
  } else {
    console.log(
      `  • sem certificado: aplicando assinatura ad-hoc completa (o app pedirá botão direito → Abrir)  app=${appName}.app`
    )
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  }

  // rede de segurança: bundle que não verifica não sai daqui
  try {
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    })
  } catch (err) {
    const detail = `${err.stdout ?? ''}${err.stderr ?? ''}`.trim()
    throw new Error(
      `assinatura do ${appName}.app não verifica — no Mac de quem baixar isso vira "arquivo danificado". Detalhe do codesign: ${detail}`
    )
  }
  console.log('  • codesign --verify --deep --strict passou')
}
