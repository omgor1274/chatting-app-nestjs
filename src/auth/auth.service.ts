import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) { }


  //   Register
  async register(data: RegisterDto) {
    const { email, password, name } = data;

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      throw new BadRequestException('User already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.prisma.user.create({
      data: {
        email,
        name,
        password: hashedPassword,
      },
    });

    console.log(user);

    //AUTO LOGIN TOKEN
    const token = this.jwt.sign({
      userId: user.id,
      email: user.email,
    });

    return {
      message: 'User registered & logged in',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }



  //                   LOGIN 
  async login(email: string, password: string) {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      throw new BadRequestException('Invalid credentials');
    }

    const token = this.jwt.sign({
      userId: user.id,
      email: user.email,
    });

    return {
      message: 'Login successful',
      token,
    };
  }
}