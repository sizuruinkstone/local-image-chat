import test from "node:test";
import assert from "node:assert/strict";
import {preparePromptImport} from "../public/frontend/components/prompt/prompt-import-dialog.js";
test("Studio imports structured sections, negative and weighted triggers through the existing parser",()=>{
 const result=preparePromptImport("Character: teapot\nStyle: watercolor\nLoRA Trigger Words: (ink:1.2)\nNegative Prompt: blur");
 assert.equal(result.patch.sections.character,"teapot");assert.equal(result.patch.sections.style,"watercolor, (ink:1.2)");assert.equal(result.patch.negative,"blur");assert.equal(result.preview,"teapot, watercolor, (ink:1.2)");
});
test("Studio import preserves raw text and reports unrecognized lines without silent deletion",()=>{
 assert.deepEqual(preparePromptImport("plain prompt, (ink:1.2)").patch,{positive:"plain prompt, (ink:1.2)"});
 assert.equal(preparePromptImport("Negative Prompt: blur").patch.positive,undefined);
 const result=preparePromptImport("# Unsupported\nlost text\nCharacter: teapot");assert.ok(result.warnings.includes("lost text"));
 assert.throws(()=>preparePromptImport("  "));
});
