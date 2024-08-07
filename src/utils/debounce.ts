export const debounce = <T extends (...args: any[]) => void>(
  func: T,
  wait: number,
): T => {
  let timeout: NodeJS.Timeout;
  return ((...args: Parameters<T>) => {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  }) as T;
};
