// The one esbuild plugin that teaches `@shared/x` where `shared/x.ts` is.
//
// The build, the search suite and the shared-module loader all bundle the same sources, and a
// second copy of this is how one of them ends up resolving to a file the others do not.

import { join } from 'node:path';

export const sharedAlias = (root) => ({
  name: 'shared-alias',
  setup(build) {
    build.onResolve({ filter: /^@shared\// }, (args) => ({
      path: join(root, 'shared', `${args.path.replace('@shared/', '')}.ts`),
    }));
  },
});
