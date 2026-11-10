/**
 * **v0.1 的冻结 schema** —— 永不修改。
 *
 * 为什么冻结：改了等于让旧文件的语义漂移。历史版本的 schema 是「当时那个版本的契约」，
 * 不是「现在的契约」。
 */
import { OdDocumentSchema } from '../schema.js'

export const OdDocumentV01 = OdDocumentSchema
