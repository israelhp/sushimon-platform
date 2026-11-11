#!/usr/bin/env node
import { evaluateBash } from './lib.mjs';
import { readInput, respond } from './run-hook.mjs';

const input = await readInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
respond(evaluateBash(String(input.tool_input?.command ?? ''), { projectDir }));
