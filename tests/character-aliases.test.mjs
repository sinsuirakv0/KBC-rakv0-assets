import assert from "node:assert/strict";
import {test} from "node:test";
import {editCharacterAliasOverrides} from "../scripts/edit-character-aliases.mjs";

test("alias editing preserves intentional spaces and rejects unknown IDs",()=>{
  const characterIndex={units:[{id:"000",forms:[],aliases:[]}]};
  const overrides={schemaVersion:1,units:{}};
  const result=editCharacterAliasOverrides({characterIndex,overrides,id:0,action:"add",alias:"Mr. "});
  assert.deepEqual(result.aliases,["Mr. "]);
  assert.deepEqual(overrides.units,{});
  assert.throws(()=>editCharacterAliasOverrides({characterIndex,overrides,id:99,action:"add",alias:"x"}));
});
