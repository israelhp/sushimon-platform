#!/usr/bin/env node
import { evaluateFileWrite } from './lib.mjs';
import { readInput, respond } from './run-hook.mjs';

const input = await readInput();
const projectDir = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
respond(evaluateFileWrite(input.tool_input ?? {}, { projectDir }));
