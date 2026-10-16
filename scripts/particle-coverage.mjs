// How much of the game's particle effects the viewer draws: the dataset's count of every operator
// class used by the heroes' and items' effects, against the classes src/viewer/particles handles.
//   npm run particles:coverage
import { supportedClasses } from "../src/viewer/particles/operators.js";

const BASE = "https://huggingface.co/datasets/Sqls1/dota2-models/resolve/main/";
const coverage = await (await fetch(`${BASE}particles/coverage.json`)).json();
const entries = Object.entries(coverage.classes);
const total = entries.reduce((sum, [, count]) => sum + count, 0);
const done = entries.filter(([name]) => supportedClasses.has(name));
const covered = done.reduce((sum, [, count]) => sum + count, 0);
console.log(`${coverage.systems} systems, ${entries.length} operator classes used ${total} times`);
console.log(`Handled: ${done.length} classes, ${((covered / total) * 100).toFixed(1)}% of the uses`);
console.log("Most used of the rest:");
for (const [name, count] of entries.filter(([name]) => !supportedClasses.has(name)).slice(0, 30)) {
  console.log(`  ${String(count).padStart(6)}  ${name}`);
}
