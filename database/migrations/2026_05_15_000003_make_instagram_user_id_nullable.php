<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table) {
            $table->string('instagram_user_id')->nullable()->change();
        });

        DB::table('instagram_accounts')
            ->where('instagram_user_id', 'like', 'pending_%')
            ->update(['instagram_user_id' => null]);
    }

    public function down(): void
    {
        Schema::table('instagram_accounts', function (Blueprint $table) {
            $table->string('instagram_user_id')->nullable(false)->change();
        });
    }
};
