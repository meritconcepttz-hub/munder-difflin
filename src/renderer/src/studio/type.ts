/** mOffice type: the same faces as mDashboard and the rest of mSuite.
 *
 *  mSuite sets everything in the platform's own face, SF Pro on Apple devices
 *  and Inter elsewhere, with SF Pro Rounded for headline figures (mDashboard:
 *  src/index.css --font-sans / --font-rounded, docs/interface-design.md).
 *  Labels are sentence case, never tracked-out capitals, and weights stay
 *  between 400 and 700. The studio floor follows that rather than Munder
 *  Difflin's pixel display face, so mOffice reads as part of the suite.
 *
 *  Inter ships inside this app (design/fonts.css), so the fallback renders
 *  offline too. */
export const SUITE_SANS =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const SUITE_ROUNDED =
  'ui-rounded, "SF Pro Rounded", -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif';

/** For Pixi text on the floor (nameplates and thought clouds). A canvas font
 *  needs `system-ui` to find the platform face; Inter follows for the rest. */
export const SUITE_CANVAS = '-apple-system, BlinkMacSystemFont, system-ui, "Inter", "Segoe UI", Roboto, Arial, sans-serif';

/** mSuite's copper, the colour of the "m" in every app's wordmark
 *  (mDashboard --brand: light #BC753F, dark hsl(28 56% 56%)). */
export const SUITE_COPPER = '#BC753F';
export const SUITE_COPPER_DARK = '#D08F5A';
