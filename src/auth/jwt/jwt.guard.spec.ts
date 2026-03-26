import { JwtGuard } from './jwt.guard';

describe('JwtGuard', () => {
  it('should be defined', () => {
    expect(
      new JwtGuard(
        { verify: jest.fn() } as never,
        { user: { findUnique: jest.fn() } } as never,
      ),
    ).toBeDefined();
  });
});
