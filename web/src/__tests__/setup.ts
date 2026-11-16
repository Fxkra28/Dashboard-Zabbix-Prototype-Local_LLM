import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Testing Library unmounts after each test by itself only when vitest globals are on; they are off here.
afterEach(() => cleanup());

// jsdom has no scrollIntoView, and a page that brings a panel into view (UX-52, UX-62) would throw in a test that is not about that. A test that is sets its own.
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined;
