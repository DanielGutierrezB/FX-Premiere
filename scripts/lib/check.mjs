// The one assertion helper every suite shares: a labelled check, a failure counter, and the
// exit-code footer.

let failures = 0;

export const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
    failures += 1;
  }
};

export const failureCount = () => failures;

/** Prints the verdict and exits non-zero if anything failed. */
export const finish = (suite) => {
  console.log(`\n${failures === 0 ? `All ${suite} tests passed` : `${failures} failing check(s)`}`);
  process.exit(failures === 0 ? 0 : 1);
};
