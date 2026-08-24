/**
 * Testing Library registers its automatic cleanup only when a global `afterEach`
 * exists. This project runs vitest with `globals: false`, so cleanup must be
 * wired explicitly. Without it, every render accumulates in the same document
 * and queries fail with "found multiple elements".
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());
