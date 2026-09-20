// WHICH SUITES A CHANGE TURNS ON, in one place. The rule lived in a bash
// heredoc inside continuous-integration.yml, where nothing could test it — and
// the `ci` aggregator exists precisely because a filter that decides wrong
// turns into a green pull request with nothing run. Now the workflow and
// `/ct-premerge` ask the same object, and it is the object that is tested.
export class ChangedPackages {
  static PACKAGES = Object.freeze(['plugin', 'backend', 'frontend'])

  // Nothing outside the three packages can be attributed to one of them, and a
  // diff nobody could read is not evidence of a small change: both turn
  // everything on rather than guessing.
  static of(files) {
    const paths = (files ?? []).filter((file) => typeof file === 'string' && file.trim().length > 0)
    if (paths.length === 0) return ChangedPackages.everything()
    const touched = { plugin: false, backend: false, frontend: false }
    for (const path of paths) {
      const owner = ChangedPackages.#ownerOf(path)
      if (owner === null) return ChangedPackages.everything()
      touched[owner] = true
    }
    // The one dependency edge: backend/ compiles and tests against plugin/
    // sources, so a plugin change has to be checked on the backend side too.
    if (touched.plugin) touched.backend = true

    return touched
  }

  static everything() {
    return { plugin: true, backend: true, frontend: true }
  }

  static namesIn(touched) {
    return ChangedPackages.PACKAGES.filter((name) => touched[name] === true)
  }

  static outputFor(touched) {
    return ChangedPackages.PACKAGES.map((name) => `${name}=${touched[name] === true}`).join('\n')
  }

  static #ownerOf(path) {
    const owner = path.split('/')[0]

    return ChangedPackages.PACKAGES.includes(owner) && path.includes('/') ? owner : null
  }
}
