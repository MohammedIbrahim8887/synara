# Sona artwork

The app uses Sona as its visible brand. Existing package names, data directories,
protocols, and update identities remain compatible with the existing installation.
The running Electrobun preview is kept open; its native title updates on its next
build and launch.

Assets generated with the built-in imagegen tool:

- `apps/web/public/branding/sona-logo.png`: transparent doughnut mark, resized to 512px.
- `apps/web/public/branding/sona-welcome.jpg`: welcome background, compressed as JPEG.

The web logo adapter preserves the existing shared SVG sizing and accessibility
contract. Existing logo consumers and the onboarding illustration reuse it.

## Generation prompts

Logo:

> Use case: logo-brand. Create a polished standalone doughnut logo for a coding workspace called Sona. No lettering. A single bold rounded doughnut ring with warm golden pastry edge, soft coral pink icing, and just a few tiny cream sprinkles. Simple memorable silhouette, subtle premium dimensional shading, centered front-on with clearly open hole. Readable at 24px, clean edges, no plate, no shadow outside the mark, no background. Actual transparent background. Square composition with modest padding.

Welcome artwork:

> Use case: stylized-concept. Asset type: wide welcome-screen background for Sona coding workspace. Primary request: premium artistic doughnut landscape replacing a dark code landscape. Wide 16:9 composition, near-black charcoal backdrop, a beautifully sculpted oversized golden doughnut with soft coral pink icing floating in the lower right half, subtle tiny cream sprinkles and soft warm rim light, secondary partial doughnut forms receding softly into dark at lower left. Refined tactile 3D studio art, elegant and restrained. Upper half nearly empty charcoal for white heading and controls overlaid by app. Keep brightest objects near bottom and sides so central provider diagram remains legible. No text, no logos, no UI, no watermark.

## Pixel background and native app icons

`apps/web/public/branding/sona-welcome-pixel.png` is the pixel-art welcome background.
The earlier JPEG remains the editable source reference.

Built-in imagegen edit prompt (input: the welcome JPEG):

> Edit this welcome-screen artwork into crisp pixel art. Preserve the exact wide composition, charcoal empty upper half, the large coral iced doughnut at lower right, smaller doughnuts at bottom left, warm golden pastry and cream sprinkles. Render all artwork on a visibly coarse square pixel grid, retro game background style with deliberate stepped edges and limited-color dithered shading. No smooth photorealistic texture, no blur. Keep upper half dark for overlaid text. No added words, logos or UI.

`apps/desktop/electrobun/assets/` contains the doughnut app icon as a macOS
iconset and ICNS, a multiresolution Windows ICO, and a Linux PNG. The iconset
contains standard and Retina sizes through 1024px. These are packaging derivatives
of the generated transparent logo, created with sips and iconutil. Electrobun's
configuration references the iconset, ICO, and PNG for their respective platforms.
Windows and Linux packaging remain unverified locally. Existing Electron release
icons are outside this Electrobun preview change.
