/**
 * `od mcp` 的实现 —— **把 od 文档暴露给 agent**（研究文档 §5.1 第 2 条）。
 *
 * MCP server 由 `@opendesigner/od-mcp` 提供（与本分支并行开发）。
 * 包没落地时 `od mcp` 报「需要 @opendesigner/od-mcp」并走**退出码 3**。
 *
 * 与 apply 一样用「变量形式的 specifier」：TS 不做静态解析，包没落地时
 * `tsc` 依然零错误；包落地后运行时会正常解析到它。
 */
import { OdCliError, errorDetail } from './cli-error.js'

const OD_MCP_SPECIFIER = '@opendesigner/od-mcp'

interface OdMcpApi {
  startMcpServer?: (options: { file: string }) => unknown | Promise<unknown>
}

/**
 * 启动 MCP server（stdio）。
 *
 * server 自己管生命周期 —— `startMcpServer` 返回后进程会一直活着，
 * 直到客户端断开连接。
 */
export async function startMcpServer(file: string): Promise<void> {
  let mod: OdMcpApi
  try {
    mod = (await import(OD_MCP_SPECIFIER)) as OdMcpApi
  } catch (error) {
    throw new OdCliError(
      'unsupported',
      'MCP server 需要 @opendesigner/od-mcp，当前环境没有安装',
      errorDetail(error),
      'npm i @opendesigner/od-mcp'
    )
  }
  if (typeof mod.startMcpServer !== 'function') {
    throw new OdCliError(
      'unsupported',
      '@opendesigner/od-mcp 缺少 startMcpServer',
      '装到的包版本不对',
      'npm i @opendesigner/od-mcp'
    )
  }
  await mod.startMcpServer({ file })
}
