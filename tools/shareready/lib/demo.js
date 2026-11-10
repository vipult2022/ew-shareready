/** Sample pages for demo mode (no Experience Workspace, or ?demo in the URL). */
export const DEMO_PAGES = {
  'spring-savings': { label: 'Spring Savings (needs work)', path: '/offers/spring-savings' },
  'everyday-checking': { label: 'Everyday Checking (ready)', path: '/accounts/everyday-checking' },
};
export const DEMO_HOST = 'www.northwind-bank.example';
export const DEMO_BRAND = 'Northwind Bank';

export function demoUrl(name) {
  return new URL(`../demo/${name}.html`, import.meta.url);
}

export function demoIndexUrl() {
  return new URL('../demo/query-index.json', import.meta.url);
}
