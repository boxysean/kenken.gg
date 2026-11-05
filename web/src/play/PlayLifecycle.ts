// Play mode's own phases; deliberately separate from SolveLifecycle, which
// describes the solver page.
export enum PlayLifecycle {
  Choosing = 1,
  Playing = 2,
  Won = 3,
}

export default PlayLifecycle;
