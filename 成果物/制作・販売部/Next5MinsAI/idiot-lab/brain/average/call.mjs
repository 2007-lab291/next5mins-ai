// 平凡の呼び出し(8-5)。中身はバカと同じ askModel。本物のAIは社長が動かす。
import { askModel } from '../call.mjs';
import { AVERAGE_REPLY_SCHEMA, checkAverageReply } from './schema.mjs';

export function askAverage(opts = {}) {
  return askModel({ ...opts, schema: AVERAGE_REPLY_SCHEMA, check: checkAverageReply });
}
