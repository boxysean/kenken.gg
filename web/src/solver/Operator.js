export const Operator = {
  Addition: '+',
  Subtraction: '-',
  Multiplication: 'x',
  Division: '/',
  Constant: '',
};

export function operatorFromString(s) {
  switch (s) {
    case '+': return Operator.Addition;
    case '-': return Operator.Subtraction;
    case 'x': return Operator.Multiplication;
    case '*': return Operator.Multiplication;
    case '/': return Operator.Division;
    case '':  return Operator.Constant;
    case '.': return Operator.Constant;
    default:  return Operator.Constant;
  }
}

export default Operator;
