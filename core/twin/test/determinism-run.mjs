// determinism.test.mjs 的子行程：印出同一段情境的 spe>hub 輸出
import { transcript } from './scenario.mjs';
process.stdout.write(transcript() + '\n');
