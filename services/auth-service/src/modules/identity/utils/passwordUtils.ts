import bcrypt from 'bcryptjs';

/** Hash a password using bcrypt */
export const hashPassword = async (password: string): Promise<string> => {
    const salt = await bcrypt.genSalt(10);
    return bcrypt.hash(password, salt);
};

/** Compare password with hashed password */
export const comparePassword = (password: string, hashedPassword: string): Promise<boolean> =>
    bcrypt.compare(password, hashedPassword);
