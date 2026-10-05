/* שולי, התחשית המרלית שמלווה את האפליקציה. הכל SVG שנבנה בקוד, בלי קובצי תמונה. */
(function () {
    'use strict';

    const C = {
        coat: '#C39370', far: '#A0745A', dark: '#5E4033', mid: '#8F6248', cream: '#EBD3B2',
        tan: '#DDB68C', ear: '#6A4535', nose: '#3A2A22', eye: '#2E211B', collar: '#E3B662', tag: '#CC6E55'
    };

    // מערכת הצירים: 200 על 76, הקרקע ב-y=73, שולי פונה שמאלה.
    const W = 200, H = 76;
    const FRONT_END = 96;   // עד כאן החלק הקדמי (ראש, חזה, רגליים קדמיות)
    const REAR_START = 140; // מכאן החלק האחורי (ישבן, רגליים אחוריות, זנב)
    const REAR_W = 62;      // רוחב החלק האחורי, עם מעט מרווח לזנב המכשכש
    const BODY_TOP = 30, BODY_H = 28;

    let seq = 0;

    const farLegs = {
        front: `<rect x="81" y="50" width="10" height="19" rx="5" fill="${C.far}"/><ellipse cx="84" cy="69.4" rx="7.4" ry="3.4" fill="${C.far}"/>`,
        rear: `<rect x="148" y="50" width="10" height="19" rx="5" fill="${C.far}"/><ellipse cx="151" cy="69.4" rx="7.4" ry="3.4" fill="${C.far}"/>`
    };

    const tail = `<g class="shuli-tail"><path d="M179 41 C191 40 197 28 194 13" stroke="${C.coat}" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M194.6 19 C195 17 194.6 15 194 13" stroke="${C.dark}" stroke-width="6" stroke-linecap="round" fill="none"/></g>`;

    // צורות הגוף משמשות גם לציור וגם כמסכה לכתמי המרל.
    function bodyShapes(x1, x2) {
        return `<rect x="${x1}" y="${BODY_TOP}" width="${x2 - x1}" height="${BODY_H}" rx="14"/>`;
    }
    const chest = `<ellipse cx="71" cy="46" rx="16" ry="17"/>`;
    const haunch = `<ellipse cx="168" cy="46.5" rx="14.5" ry="15"/>`;
    const neck = `<path d="M36 29 C42 38 50 44 57 48 L96 34 C82 31 67 22 55 8 Z"/>`;
    const head = `<ellipse cx="40" cy="21" rx="16.5" ry="15"/>`;
    const snout = `<path d="M31 11.5 C20 12.5 9 18.5 5 24 C2 28.2 5 33 11 33.6 C22 35 33 34.2 41 31 Z"/>`;

    const nearLegs = {
        front: `<rect x="65" y="50" width="11.5" height="20" rx="5.75" fill="${C.coat}"/><ellipse cx="68.4" cy="69.6" rx="8.4" ry="3.8" fill="${C.tan}"/>`,
        rear: `<rect x="161" y="50" width="11.5" height="20" rx="5.75" fill="${C.coat}"/><ellipse cx="164.4" cy="69.6" rx="8.4" ry="3.8" fill="${C.tan}"/>`
    };

    const patches = {
        head: `<ellipse cx="48" cy="13" rx="10" ry="7" fill="${C.dark}"/><ellipse cx="19" cy="20.5" rx="5.5" ry="3" transform="rotate(-18 19 20.5)" fill="${C.mid}"/><circle cx="27" cy="27.5" r="1.6" fill="${C.cream}"/>`,
        front: `<ellipse cx="83" cy="35" rx="9.5" ry="5.2" transform="rotate(-14 83 35)" fill="${C.dark}"/><ellipse cx="89.5" cy="40" rx="4.6" ry="3.8" fill="${C.dark}"/><ellipse cx="62" cy="50" rx="5.5" ry="6" fill="${C.mid}"/><circle cx="79" cy="47" r="2" fill="${C.cream}"/><circle cx="91" cy="52" r="1.6" fill="${C.cream}"/>`,
        middle: `<ellipse cx="118" cy="49.5" rx="10.5" ry="5.2" transform="rotate(8 118 49.5)" fill="${C.dark}"/><ellipse cx="109.5" cy="46.5" rx="5" ry="4" fill="${C.dark}"/><ellipse cx="129" cy="36" rx="7.5" ry="4" transform="rotate(-8 129 36)" fill="${C.mid}"/><circle cx="104" cy="36.5" r="2" fill="${C.cream}"/><circle cx="135" cy="52" r="1.7" fill="${C.cream}"/>`,
        rear: `<ellipse cx="152" cy="36" rx="8.5" ry="5" transform="rotate(10 152 36)" fill="${C.dark}"/><ellipse cx="159" cy="40.5" rx="4.6" ry="3.8" fill="${C.dark}"/><ellipse cx="173" cy="50" rx="6" ry="7" fill="${C.mid}"/><circle cx="146" cy="51" r="2" fill="${C.cream}"/><circle cx="178" cy="37" r="1.8" fill="${C.cream}"/>`
    };

    const collar = `<path d="M50.5 39.5 L67 24" stroke="${C.collar}" stroke-width="5.6" stroke-linecap="round" fill="none"/><path d="M49.5 43.5 c-2.4 -2.6 -5.6 0.2 -3 3.4 l3 3 l3 -3 c2.6 -3.2 -0.6 -6 -3 -3.4z" fill="${C.tag}"/>`;

    const face = `<ellipse cx="6.2" cy="24.4" rx="4.7" ry="4.1" fill="${C.nose}"/><ellipse cx="5" cy="23" rx="1.5" ry="1" fill="#6b5347"/>`
        + `<path d="M9.5 31 C14 34 20 34.2 25.5 32" stroke="${C.dark}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`
        + `<ellipse cx="34.5" cy="12.2" rx="3.2" ry="1.7" transform="rotate(-12 34.5 12.2)" fill="${C.tan}"/>`
        + `<g class="shuli-eye"><circle cx="33" cy="18.3" r="2.9" fill="${C.eye}"/><circle cx="32.1" cy="17.3" r="1" fill="#fff"/></g>`
        + `<ellipse cx="26.5" cy="26.8" rx="3.4" ry="2" fill="${C.tag}" opacity=".28"/>`;

    const ear = `<path class="shuli-ear" d="M44 6.5 C57.5 3.5 67.5 17 63.5 35.5 C61.5 44.6 51.2 45.4 49.2 36.2 C47.6 28 41 17 44 6.5 Z" fill="${C.ear}"/>`;

    const muzzle = `<path d="M12 33.4 C22 34.9 33 34.1 41 31 L38 27.5 C30 30.5 20 31.2 9.5 29.6 Z" fill="${C.tan}"/>`;
    const frontShapes = chest + neck + head + snout;

    function svgOpen(viewBox, cls, label) {
        const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
        return `<svg class="${cls}" viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" ${a11y} focusable="false">`;
    }

    /** שולי בשלמותה, עומדת ופונה שמאלה. */
    function full(cls, label) {
        const id = 'shuli-clip-' + (++seq);
        const shapes = bodyShapes(60, 184) + haunch + frontShapes;
        return svgOpen(`0 0 ${W} ${H}`, 'shuli ' + (cls || ''), label)
            + `<defs><clipPath id="${id}">${shapes}</clipPath></defs>`
            + farLegs.rear + tail + farLegs.front
            + `<g fill="${C.coat}">${shapes}</g>` + muzzle
            + `<g clip-path="url(#${id})">${patches.head}${patches.front}${patches.middle}${patches.rear}</g>`
            + collar + nearLegs.rear + nearLegs.front + face + ear
            + '</svg>';
    }

    /** החלק הקדמי של שולי המתמתחת (מד ההתקדמות). */
    function front() {
        const id = 'shuli-clip-' + (++seq);
        const shapes = bodyShapes(60, 130) + frontShapes;
        return svgOpen(`0 0 ${FRONT_END} ${H}`, 'shuli-front')
            + `<defs><clipPath id="${id}">${shapes}</clipPath></defs>`
            + farLegs.front
            + `<g fill="${C.coat}">${shapes}</g>` + muzzle
            + `<g clip-path="url(#${id})">${patches.head}${patches.front}</g>`
            + collar + nearLegs.front + face + ear
            + '</svg>';
    }

    /** החלק האחורי של שולי המתמתחת. */
    function rear() {
        const id = 'shuli-clip-' + (++seq);
        const shapes = bodyShapes(110, 184) + haunch;
        return svgOpen(`${REAR_START} 0 ${REAR_W} ${H}`, 'shuli-rear')
            + `<defs><clipPath id="${id}">${shapes}</clipPath></defs>`
            + farLegs.rear + tail
            + `<g fill="${C.coat}">${shapes}</g>`
            + `<g clip-path="url(#${id})">${patches.rear}</g>`
            + nearLegs.rear
            + '</svg>';
    }

    /** הגוף המתארך עצמו: פס בצבע הפרווה שנמתח לרוחב, באותם צירים אנכיים של שני הקצוות. */
    function bodyFill() {
        return `<svg class="dog-fill" viewBox="0 0 10 ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect x="0" y="${BODY_TOP}" width="10" height="${BODY_H}" fill="${C.coat}"/></svg>`;
    }

    /** כתמי המרל לגוף המתארך: שלושה אריחים שקופים שמתפזרים לאורך הגוף בלי להיחתך. */
    function bodyTiles() {
        const tile = (w, inner) => `url("data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${BODY_H}" width="${w}" height="${BODY_H}">${inner}</svg>`)}")`;
        return [
            tile(58, `<ellipse cx="31" cy="18.5" rx="10" ry="5" transform="rotate(8 31 18.5)" fill="${C.dark}"/><ellipse cx="23" cy="15.5" rx="5" ry="4" fill="${C.dark}"/>`),
            tile(84, `<ellipse cx="42" cy="8" rx="7.5" ry="4" transform="rotate(-10 42 8)" fill="${C.mid}"/><circle cx="66" cy="20" r="2" fill="${C.cream}"/>`),
            tile(37, `<circle cx="18" cy="23.5" r="1.8" fill="${C.cream}"/><circle cx="9" cy="6" r="1.5" fill="${C.cream}"/>`)
        ];
    }

    /** טביעת כף רגל. */
    function paw(cls) {
        return `<svg class="${cls || 'paw'}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor">`
            + '<ellipse cx="12" cy="16.2" rx="5.4" ry="4.4"/><ellipse cx="5.3" cy="10.8" rx="2.2" ry="2.9" transform="rotate(-22 5.3 10.8)"/>'
            + '<ellipse cx="9.4" cy="6.6" rx="2.2" ry="3"/><ellipse cx="14.6" cy="6.6" rx="2.2" ry="3"/>'
            + '<ellipse cx="18.7" cy="10.8" rx="2.2" ry="2.9" transform="rotate(22 18.7 10.8)"/></svg>';
    }

    window.Shuli = {
        full, front, rear, bodyFill, bodyTiles, paw, colors: C,
        geometry: { W, H, FRONT_END, REAR_START, REAR_W, BODY_TOP, BODY_H }
    };
})();
