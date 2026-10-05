export type Callback<Args extends readonly unknown[], Result = void> = (
  ...args: Args
) => typeof args extends never ? Result : Result;
