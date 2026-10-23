from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List, Optional
import os
from dotenv import load_dotenv


def get_environment():
    """获取当前环境"""
    return os.getenv("ENVIRONMENT", "development")


def load_environment_config():
    """根据环境加载配置文件"""
    env = get_environment()
    env_file = f".env.{env}"
    
    # 如果环境配置文件存在，则加载它
    if os.path.exists(env_file):
        load_dotenv(env_file)
        print(f"加载环境配置文件: {env_file}")
    else:
        # 否则尝试加载默认的 .env 文件
        if os.path.exists(".env"):
            load_dotenv(".env")
            print("加载默认配置文件: .env")
        else:
            print("未找到环境配置文件，使用默认值")


# 加载环境配置
load_environment_config()


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    
    DATABASE_URL: str = "sqlite:///./learning.db"
    
    # JWT 配置
    SECRET_KEY: str = "your-secret-key-change-in-production-1234567890"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 7
    
    # SMTP 邮箱配置
    EMAIL_HOST: str = "smtp.qq.com"
    EMAIL_PORT: int = 465
    EMAIL_SECURE: bool = True
    EMAIL_USER: str = "yibianguo@foxmail.com"
    EMAIL_PASS: str = ""
    
    DEEPSEEK_API_KEYS_STR: str = ""
    DEEPSEEK_BASE_URL: str = "https://api.deepseek.com/v1"
    
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:5174,http://localhost:3000,capacitor://localhost"

    # 模型缓存目录（生产环境建议设置为持久化存储路径）
    MODEL_CACHE_DIR: str = "model_cache"

    model_config = SettingsConfigDict(
        env_file=None,  # 手动加载，不使用自动加载
        env_file_encoding='utf-8',
        case_sensitive=True,
        extra='ignore'
    )


# 创建设置实例
settings = Settings()

# 手动解析 API keys
def get_deepseek_api_keys() -> List[str]:
    if settings.DEEPSEEK_API_KEYS_STR:
        return [
            key.strip() for key in settings.DEEPSEEK_API_KEYS_STR.split(",") 
            if key.strip()
        ]
    return []

