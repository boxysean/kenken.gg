export class KenKenSolverException extends Error {
  constructor(message = '', cause = null) {
    super(message);
    this.name = 'KenKenSolverException';
    this.cause = cause;
  }
}

export default KenKenSolverException;
