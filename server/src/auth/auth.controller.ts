import { Body, Controller, Get, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Public, Auth, CurrentUser } from '../common/decorators';
import { AuthUser } from '../common/user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public()
  @Post('login')
  login(@Body() body: { username: string; password: string }) {
    return this.auth.login(body.username, body.password);
  }

  @Auth()
  @Get('profile')
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.profile(user.id);
  }

  @Auth()
  @Post('password')
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() body: { oldPassword: string; newPassword: string },
  ) {
    return this.auth.changePassword(user.id, body.oldPassword, body.newPassword);
  }
}
