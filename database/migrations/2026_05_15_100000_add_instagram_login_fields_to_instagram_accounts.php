<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table) {
            $table->string('login_provider')->default('instagram')->after('user_id');
            $table->string('instagram_scoped_id')->nullable()->after('instagram_user_id');
            $table->text('granted_permissions')->nullable()->after('account_type');
            $table->timestamp('messages_synced_at')->nullable()->after('token_expires_at');
        });
    }

    public function down(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table) {
            $table->dropColumn([
                'login_provider',
                'instagram_scoped_id',
                'granted_permissions',
                'messages_synced_at',
            ]);
        });
    }
};
