<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instagram_conversations', function (Blueprint $table) {
            $table->timestamp('last_read_at')->nullable()->after('last_message_at');
        });
    }

    public function down(): void
    {
        Schema::table('instagram_conversations', function (Blueprint $table) {
            $table->dropColumn('last_read_at');
        });
    }
};
