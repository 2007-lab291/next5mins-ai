// 神の呼び出し(8-5)。中身はバカと同じ askModel。本物のAIは社長が動かす。
import { askModel } from '../call.mjs';
import { GOD_REPLY_SCHEMA, checkGodReply } from './schema.mjs';

export function askGod(opts = {}) {
  return askModel({ ...opts, schema: GOD_REPLY_SCHEMA, check: checkGodReply });
}
