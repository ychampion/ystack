# Presenting like a top studio

Imagine the page is being pitched by a small, expensive studio to a client deciding on a very large
contract. Studios like that win on restraint, real content and specific claims, and on visible care in
the details nobody asked for. They never pad, never invent, and never show work they have not looked at.

## Contents

1. The ten principles
2. The copy deck
3. Craft details
4. The build report
5. Screenshots

## 1. The ten principles

1. **Say what it is in under ten words,** then name the concrete nouns: "Every computer your agent
   needs." then "Sandboxes, swarms, desktops and phones for your agents." A buyer knows what it is and
   who it is for within three seconds.
2. **Be specific enough to check:** prices, latencies, limits, named customers, footnotes on
   comparisons. "$0.011 / hour awake" beats any adjective. If a number is not real, cut it.
3. **Show it working:** real UI fragments built as working components, real commands with a copy
   button, an interactive demo or calculator. One true fragment beats six illustrations.
4. **Take one idea from the subject and let it carry information** (one boat = one VM).
5. **Use a device only when it carries information** (`devices.md`).
6. **Keep the system small:** one ground, one ink, one accent or hue family; one sans; three to five
   sizes far apart; one radius; generous section spacing; text in full-contrast ink.
7. **Spend boldness in one place:** one memorable moment per page. Everything else stays quiet.
8. **Motion answers the story or the user,** and respects reduced motion.
9. **Design the unglamorous states:** empty ("Nothing is running yet: nothing billed"), loading, error,
   mobile, the footer as a designed close, install tabs per OS, fine print where caveats belong.
10. **Never claim done without looking:** screenshots at three widths, read, fixed, read again.

## 2. The copy deck

Write the whole page as plain text before markup, one block per section:

```
[section] claim — proof
H: headline (about 5 words, two lines at most at every width)
S: one supporting sentence, plain, says what it is if the headline is a figure of speech
B: body, full content (every plan, every spec, every answer)
A: the one action, named for what it does
```

- Benefits in plain English: saves time, saves money, why it is different, why you need it now.
  Technical depth goes in docs; on the page, a CLI is for agents and people get an app or an agent.
- Present the product as it is offered today (private beta, invite-only, public). No "roadmap",
  "building" or "research" labels on the page, and no investors page.
- Sample details are allowed where the brief has gaps (a plan name, a sample command) so the design is
  seen at full density; list them in the report to confirm. **Proof is never invented.**

## 3. Craft details

The details that separate a studio's page from a generator's: a "Scroll to explore ↓" affordance that
is a real link; install lines with OS tabs and a copy button that confirms; a cursor that changes over
an interactive scene; a picture that dissolves into the ground instead of ending on a hard edge;
footnotes with superscripts on every comparison; an empty state written in the product's voice; a
footer that restates the promise at full width or closes with something from the product's world; a
favicon and an OG image made for this page; working focus states; nothing that jumps on load.

## 4. The build report

Lead with the outcome, keep it to a screen, and put long output in files.

```
## <Page> — <one-line idea sentence>

Screenshots: <1440>, <768>, <375> (paths; the hero first, then the signature moment)

The idea: On this page, <inventory item> becomes <technique>.
The system: ground <hex>, ink <hex>, accent <hex>; <face> (+ mono for <what>); sizes <n>; radius <r>.
The argument: <section>: <claim> — <proof>   (one line per section)
The signature moment: <what it is, what data it carries>
Cut: <what was removed or never added, and why>
Checks: inspect.mjs 0 FAIL at 1440/768/375; <n> WARN kept, each with its one-line reason; slop-guard
        exceptions with their reasons; UX checks run.
Assets: every generated asset (file, model, prompt, cost, where used); every found picture (title,
        creator, licence, source, where credited); every drawing standing in for photography.
To confirm before launch: sample content, numbers that need a source, links not wired.
Still short of the bar: <honest list>
```

If the user sent reference sites, add a side-by-side: their frame and yours at the same width, with
one line on what you took (a principle) and what you did not (their look).

## 5. Screenshots

- Real browser, at 1440, 768 and 375, after the last change, with motion settled.
- Read every one yourself before showing any. Judge only the pictures: a problem visible in a
  screenshot is real.
- Show full sections, not crops that hide a weak neighbour. Show the phone composition as its own
  design, not the desktop squeezed.
