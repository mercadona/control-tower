export class RepositoryHistory {
  async current(root) {
    throw new Error('RepositoryHistory.current must be implemented')
  }
}
