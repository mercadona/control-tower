# Hand-vendored theme — logistics design system

**Verbatim** copy of `packages/logistics-ui/src/theme/` from the
`mercadona/mo.staff-design` repo, package `@mercadona/mo.library.logistics-ds`
0.42.1, commit `466bfd3aa5a6ca2e97dda468c15dc02e8584bef6`.

Nothing here gets edited: these are generated files (`READONLY` in the header).
The real package lives in the private Verdaccio and this repository's CI cannot
reach it; the day the repo moves to the organisation, this folder is deleted and
`main.tsx` imports `@mercadona/mo.library.logistics-ds/theme/styles.css`.

## Refreshing

```bash
git clone --depth 1 git@github.com:mercadona/mo.staff-design.git /tmp/staff
rm -rf frontend/src/system-ui/theme/{styles.css,tokens,fonts,utility-classes}
cp -R /tmp/staff/packages/logistics-ui/src/theme/{styles.css,tokens,fonts,utility-classes} frontend/src/system-ui/theme/
rm -rf frontend/src/system-ui/theme/*/__tests__
```

And update the commit above.
