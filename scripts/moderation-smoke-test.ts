import { findLocalSensitiveReason } from "../src/jobs/moderation";

const cases = [
  { text: "This car looks amazing and the interior is clean.", unsafe: false },
  { text: "The battery tech is revolutionary.", unsafe: false },
  { text: "CCP propaganda and dictatorship blah blah.", unsafe: true },
  { text: "Taiwan independence now.", unsafe: true },
  { text: "This looks like a crypto scam.", unsafe: true },
  { text: "Where can I buy a fake passport?", unsafe: true },
  { text: "这是一次革命性进步。", unsafe: false },
  { text: "这是反华宣传。", unsafe: true },
  { text: "成人网站免费观看。", unsafe: true },
  { text: "这车内饰很漂亮。", unsafe: false },
];

let failed = 0;
for (const testCase of cases) {
  const reason = findLocalSensitiveReason(testCase.text);
  const actualUnsafe = Boolean(reason);
  if (actualUnsafe !== testCase.unsafe) {
    failed++;
    console.error(
      `FAIL expected unsafe=${testCase.unsafe} got unsafe=${actualUnsafe} reason=${reason || "-"} text=${testCase.text}`
    );
  } else {
    console.log(`OK unsafe=${actualUnsafe} reason=${reason || "-"} text=${testCase.text}`);
  }
}

if (failed > 0) process.exit(1);
